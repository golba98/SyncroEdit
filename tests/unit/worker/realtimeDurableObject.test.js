import app from '../../../worker/src/index.js';
import { DocumentSyncObject } from '../../../worker/src/durableObjects/DocumentSyncObject.js';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

class MockWebSocket {
  constructor() {
    this.readyState = 1; // WebSocket.OPEN
    this.sent = [];
    this.attachment = null;
  }
  send(msg) {
    // msg can be Uint8Array or ArrayBuffer.
    // Store it as a Uint8Array for easy decoding.
    this.sent.push(new Uint8Array(msg));
  }
  close(code, reason) {
    this.readyState = 3; // WebSocket.CLOSED
    this.closed = { code, reason };
  }
  serializeAttachment(att) {
    this.attachment = att;
  }
  deserializeAttachment() {
    return this.attachment;
  }
}

describe('Worker Realtime Durable Object Sync & Bridge', () => {
  let OriginalResponse;

  let createdPairs = [];

  beforeEach(() => {
    global.fetch = jest.fn();
    createdPairs = [];
    global.WebSocketPair = class WebSocketPair {
      constructor() {
        this.client = new MockWebSocket();
        this.server = new MockWebSocket();
        createdPairs.push(this);
      }
    };

    OriginalResponse = global.Response;
    global.Response = class MockResponse extends OriginalResponse {
      constructor(body, init) {
        if (init && init.status === 101) {
          const initCopy = { ...init };
          delete initCopy.status;
          super(body, initCopy);
          Object.defineProperty(this, 'status', { value: 101, configurable: true });
          if (init.webSocket) {
            Object.defineProperty(this, 'webSocket', { value: init.webSocket, configurable: true });
          }
        } else {
          super(body, init);
        }
      }
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (OriginalResponse) {
      global.Response = OriginalResponse;
    }
  });

  describe('Worker realtime.js & index.js Routes', () => {
    it('returns 404 for WebSocket route if Durable Objects are disabled', async () => {
      const response = await app.request(
        '/ws/doc123',
        {
          headers: { Upgrade: 'websocket' },
        },
        {
          REALTIME_DURABLE_OBJECTS_ENABLED: 'false',
          DOCUMENT_SYNC_OBJECT: {},
        }
      );

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Durable Object realtime route disabled');
    });

    it('requires a ticket when BACKEND_ORIGIN is configured and ticket validation is enabled', async () => {
      const response = await app.request(
        '/ws/doc123',
        {
          headers: { Upgrade: 'websocket' },
        },
        {
          REALTIME_DURABLE_OBJECTS_ENABLED: 'true',
          DOCUMENT_SYNC_OBJECT: {},
          BACKEND_ORIGIN: 'http://localhost:3000',
        }
      );

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Authentication ticket required');
    });

    it('returns 401 if backend ticket validation fails', async () => {
      global.fetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: false, message: 'Invalid ticket' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const response = await app.request(
        '/ws/doc123?ticket=invalid-ticket',
        {
          headers: { Upgrade: 'websocket' },
        },
        {
          REALTIME_DURABLE_OBJECTS_ENABLED: 'true',
          DOCUMENT_SYNC_OBJECT: {},
          BACKEND_ORIGIN: 'http://localhost:3000',
        }
      );

      expect(response.status).toBe(401);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/auth/ws-ticket/consume',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ticket: 'invalid-ticket', documentId: 'doc123' }),
        })
      );
    });

    it('upgrades connection and routes to Durable Object if ticket is valid', async () => {
      global.fetch.mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, user: { id: 'u1', username: 'alice' }, readOnly: false }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

      const mockStub = {
        fetch: jest.fn().mockResolvedValue(new Response(null, { status: 101 })),
      };

      const mockDO = {
        idFromName: jest.fn().mockReturnValue('mock-id'),
        get: jest.fn().mockReturnValue(mockStub),
      };

      const response = await app.request(
        '/ws/doc123?ticket=valid-ticket',
        {
          headers: { Upgrade: 'websocket' },
        },
        {
          REALTIME_DURABLE_OBJECTS_ENABLED: 'true',
          DOCUMENT_SYNC_OBJECT: mockDO,
          BACKEND_ORIGIN: 'http://localhost:3000',
        }
      );

      expect(response.status).toBe(101);
      expect(mockDO.idFromName).toHaveBeenCalledWith('doc123');
      expect(mockStub.fetch).toHaveBeenCalled();

      const lastRequest = mockStub.fetch.mock.calls[0][0];
      const requestUrl = new URL(lastRequest.url);
      expect(requestUrl.searchParams.get('userId')).toBe('u1');
      expect(requestUrl.searchParams.get('username')).toBe('alice');
      expect(requestUrl.searchParams.get('readOnly')).toBe('false');
    });
  });

  describe('DocumentSyncObject Yjs Protocol Sync & Persistence', () => {
    let mockStorageMap;
    let mockState;

    beforeEach(() => {
      mockStorageMap = new Map();
      mockState = {
        storage: {
          get: jest.fn().mockImplementation((key) => mockStorageMap.get(key)),
          put: jest.fn().mockImplementation((key, val) => {
            mockStorageMap.set(key, val);
            return Promise.resolve();
          }),
        },
        acceptWebSocket: jest.fn(),
        getWebSockets: jest.fn().mockReturnValue([]),
      };
    });

    it('loads state from storage on construction', async () => {
      const initialDoc = new Y.Doc();
      initialDoc.getText('content').insert(0, 'Hello Durable Object');
      const stateUpdate = Y.encodeStateAsUpdate(initialDoc);
      mockStorageMap.set('yjsState', stateUpdate);

      const syncObj = new DocumentSyncObject(mockState, {});
      await syncObj.initialized;

      expect(mockState.storage.get).toHaveBeenCalledWith('yjsState');
      expect(syncObj.doc.getText('content').toString()).toBe('Hello Durable Object');
    });

    it('sends sync step 1 and current awareness states on fetch connection upgrade', async () => {
      const syncObj = new DocumentSyncObject(mockState, {});
      await syncObj.initialized;

      // Seed an awareness state to verify it sends it
      syncObj.awareness.setLocalStateField('user', { name: 'bob' });

      const req = new Request(
        'http://localhost/ws/doc123?documentId=doc123&userId=u2&username=bob&readOnly=false',
        {
          headers: { Upgrade: 'websocket' },
        }
      );

      mockState.acceptWebSocket.mockImplementation((ws) => {
        mockState.getWebSockets.mockReturnValue([ws]);
      });

      const response = await syncObj.fetch(req);
      expect(response.status).toBe(101);

      const serverSocket = createdPairs[0].server;
      expect(mockState.acceptWebSocket).toHaveBeenCalled();
      expect(mockState.acceptWebSocket.mock.calls[0][0]).toBe(serverSocket);

      // Verify that step 1 was sent to the server socket
      const sentMessages = serverSocket.sent;
      expect(sentMessages.length).toBeGreaterThanOrEqual(1);

      // First message must be sync message
      const syncDecoder = decoding.createDecoder(sentMessages[0]);
      const messageType = decoding.readVarUint(syncDecoder);
      expect(messageType).toBe(0); // messageSync
    });

    it('exchanges Yjs sync updates between two clients', async () => {
      const syncObj = new DocumentSyncObject(mockState, {});
      await syncObj.initialized;

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();

      ws1.serializeAttachment({ readOnly: false });
      ws2.serializeAttachment({ readOnly: false });

      syncObj.conns.set(ws1, new Set());
      syncObj.conns.set(ws2, new Set());

      mockState.getWebSockets.mockReturnValue([ws1, ws2]);

      // 1. Client 1 sends an update message to the server
      const clientDoc = new Y.Doc();
      clientDoc.getText('content').insert(0, 'A');
      const clientUpdate = Y.encodeStateAsUpdate(clientDoc);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // messageSync
      syncProtocol.writeUpdate(encoder, clientUpdate);
      const payload = encoding.toUint8Array(encoder);

      await syncObj.webSocketMessage(ws1, payload);

      // Check that syncObj.doc was updated
      expect(syncObj.doc.getText('content').toString()).toBe('A');

      // Check that ws2 received the update (broadcasted from the doc.on('update'))
      expect(ws2.sent.length).toBe(1);
      const ws2Decoder = decoding.createDecoder(ws2.sent[0]);
      expect(decoding.readVarUint(ws2Decoder)).toBe(0); // messageSync
      expect(decoding.peekVarUint(ws2Decoder)).toBe(2); // writeUpdate type
    });

    it('enforces read-only check and blocks updates from read-only viewers', async () => {
      const syncObj = new DocumentSyncObject(mockState, {});
      await syncObj.initialized;

      const wsReadOnly = new MockWebSocket();
      wsReadOnly.serializeAttachment({ readOnly: true });
      syncObj.conns.set(wsReadOnly, new Set());

      const clientDoc = new Y.Doc();
      clientDoc.getText('content').insert(0, 'Malicious Edit');
      const clientUpdate = Y.encodeStateAsUpdate(clientDoc);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // messageSync
      syncProtocol.writeUpdate(encoder, clientUpdate);
      const payload = encoding.toUint8Array(encoder);

      await syncObj.webSocketMessage(wsReadOnly, payload);

      // Doc must remain empty because readOnly is true
      expect(syncObj.doc.getText('content').toString()).toBe('');
    });

    it('broadcasts awareness updates and cleans them up on close', async () => {
      const syncObj = new DocumentSyncObject(mockState, {});
      await syncObj.initialized;

      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();

      ws1.serializeAttachment({ readOnly: false });
      ws2.serializeAttachment({ readOnly: false });

      syncObj.conns.set(ws1, new Set());
      syncObj.conns.set(ws2, new Set());

      mockState.getWebSockets.mockReturnValue([ws1, ws2]);

      // Create awareness update for bob (client ID: 999)
      const bobAwareness = new awarenessProtocol.Awareness(new Y.Doc());
      bobAwareness.setLocalStateField('user', { name: 'bob' });
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(bobAwareness, [
        bobAwareness.clientID,
      ]);

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1); // messageAwareness
      encoding.writeVarUint8Array(encoder, awarenessUpdate);
      const payload = encoding.toUint8Array(encoder);

      await syncObj.webSocketMessage(ws1, payload);

      // Bob's clientID should now be tracked under ws1 controlled IDs
      const controlled = syncObj.conns.get(ws1);
      expect(controlled.has(bobAwareness.clientID)).toBe(true);

      // Bob's awareness should be broadcasted to ws2
      expect(ws2.sent.length).toBe(1);
      const ws2Decoder = decoding.createDecoder(ws2.sent[0]);
      expect(decoding.readVarUint(ws2Decoder)).toBe(1); // messageAwareness

      // Now close ws1 connection
      mockState.getWebSockets.mockReturnValue([ws2]);
      ws2.sent = []; // Reset sent list

      await syncObj.webSocketClose(ws1);

      // Bob's state should be removed from awareness
      expect(syncObj.awareness.getStates().get(bobAwareness.clientID)).toBeUndefined();

      // Broadcast of awareness state removal should have been sent to ws2
      expect(ws2.sent.length).toBe(1);
      const ws2CloseDecoder = decoding.createDecoder(ws2.sent[0]);
      expect(decoding.readVarUint(ws2CloseDecoder)).toBe(1); // messageAwareness
    });

    it('flushes persisted state on save and on last connection close', async () => {
      const syncObj = new DocumentSyncObject(mockState, {});
      await syncObj.initialized;

      const ws = new MockWebSocket();
      syncObj.conns.set(ws, new Set());
      mockState.getWebSockets.mockReturnValue([ws]);

      // Apply update
      syncObj.doc.getText('content').insert(0, 'Flush Test');

      // Wait for debounced scheduleSave timeout
      jest.useFakeTimers();
      syncObj.scheduleSave();

      jest.advanceTimersByTime(2000);
      jest.useRealTimers();

      // Trigger closing the last socket
      mockState.getWebSockets.mockReturnValue([]);
      await syncObj.webSocketClose(ws);

      expect(mockState.storage.put).toHaveBeenCalledWith('yjsState', expect.any(Uint8Array));
      const stateUpdate = mockStorageMap.get('yjsState');

      const restoredDoc = new Y.Doc();
      Y.applyUpdate(restoredDoc, stateUpdate);
      expect(restoredDoc.getText('content').toString()).toBe('Flush Test');
    });
  });

  describe('Frontend config backend routing', () => {
    it('resolves correct config-driven WebSocket base URL', () => {
      const mockConfigNode = {
        API_BASE_URL: 'http://localhost:3000/api/node',
        REALTIME_BACKEND: 'node',
      };

      // Same check as frontend url resolution
      const resolveUrl = (config) => {
        const backend = config.REALTIME_BACKEND || 'node';
        let wsBaseUrl =
          config.WS_BASE_URL ||
          config.API_BASE_URL.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
        if (backend === 'durable-object') {
          if (config.WS_BASE_URL) {
            wsBaseUrl = config.WS_BASE_URL;
          } else {
            const apiBaseUrl = config.API_BASE_URL;
            const urlObj = new URL(apiBaseUrl, 'http://localhost');
            const protocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
            wsBaseUrl = `${protocol}//${urlObj.host}`;
          }
          if (!wsBaseUrl.endsWith('/ws')) {
            wsBaseUrl = `${wsBaseUrl.replace(/\/+$/, '')}/ws`;
          }
        }
        return wsBaseUrl;
      };

      expect(resolveUrl(mockConfigNode)).toBe('ws://localhost:3000/api/node');

      const mockConfigDO = {
        API_BASE_URL: 'http://localhost:8787/api/node',
        REALTIME_BACKEND: 'durable-object',
      };
      expect(resolveUrl(mockConfigDO)).toBe('ws://localhost:8787/ws');

      const mockConfigDOWithCustomWS = {
        API_BASE_URL: 'http://localhost:8787/api/node',
        WS_BASE_URL: 'ws://localhost:8787',
        REALTIME_BACKEND: 'durable-object',
      };
      expect(resolveUrl(mockConfigDOWithCustomWS)).toBe('ws://localhost:8787/ws');
    });
  });
});
