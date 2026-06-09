import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const messageSync = 0;
const messageAwareness = 1;

export class DocumentSyncObject {
  constructor(state, env) {
    this.ctx = state;
    this.env = env;

    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.conns = new Map();
    this.saveTimeout = null;

    // Listen to Yjs document updates to broadcast them and schedule storage save
    this.doc.on('update', (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      for (const client of this.ctx.getWebSockets()) {
        if (client !== origin && client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
      this.scheduleSave();
    });

    // Listen to awareness updates to broadcast them to other clients
    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changedClients = added.concat(updated, removed);
      if (origin && this.conns.has(origin)) {
        const connControlledIds = this.conns.get(origin);
        added.forEach((clientId) => connControlledIds.add(clientId));
        removed.forEach((clientId) => connControlledIds.delete(clientId));
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      const message = encoding.toUint8Array(encoder);

      for (const client of this.ctx.getWebSockets()) {
        if (client !== origin && client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    });

    this.initialized = this.initialize();
  }

  async initialize() {
    try {
      const state = await this.ctx.storage.get('yjsState');
      if (state) {
        Y.applyUpdate(this.doc, state);
      }
    } catch (err) {
      console.error('Error loading Yjs state from DO storage:', err);
    }
  }

  async fetch(request) {
    await this.initialized;

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const url = new URL(request.url);
    const documentId = url.searchParams.get('documentId') || 'unknown';
    const userId = url.searchParams.get('userId') || 'unknown';
    const username = url.searchParams.get('username') || 'unknown';
    const readOnly = url.searchParams.get('readOnly') === 'true';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      documentId,
      userId,
      username,
      readOnly,
      connectedAt: Date.now(),
    });

    this.conns.set(server, new Set());

    // 1. Send Sync Step 1
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, messageSync);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    server.send(encoding.toUint8Array(syncEncoder));

    // 2. Send current awareness states
    const states = Array.from(this.awareness.getStates().keys());
    if (states.length > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)
      );
      server.send(encoding.toUint8Array(awarenessEncoder));
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws, message) {
    await this.initialized;

    try {
      const attachment = ws.deserializeAttachment() || {};
      const readOnly = !!attachment.readOnly;

      const uint8Array = new Uint8Array(message);
      const decoder = decoding.createDecoder(uint8Array);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync:
          const syncEncoder = encoding.createEncoder();
          encoding.writeVarUint(syncEncoder, messageSync);

          if (readOnly) {
            const syncMessageType = decoding.peekVarUint(decoder);
            if (syncMessageType === 2) {
              // Block update messages from read-only viewers
              return;
            }
          }

          syncProtocol.readSyncMessage(decoder, syncEncoder, this.doc, ws);
          if (encoding.length(syncEncoder) > 1) {
            ws.send(encoding.toUint8Array(syncEncoder));
          }
          break;

        case messageAwareness:
          const awarenessUpdate = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(this.awareness, awarenessUpdate, ws);
          break;

        default:
          console.warn('Unknown y-websocket message type:', messageType);
      }
    } catch (err) {
      console.error('Error handling WebSocket message in Durable Object:', err);
    }
  }

  async webSocketClose(ws) {
    const controlledIds = this.conns.get(ws);
    this.conns.delete(ws);
    if (controlledIds && controlledIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(controlledIds), null);
    }

    // Flush any pending save immediately when the last client leaves
    const remaining = this.ctx.getWebSockets().length;
    if (remaining === 0) {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }
      await this.saveToStorage();
    }
  }

  async webSocketError(ws, error) {
    console.error('DocumentSyncObject WebSocket error:', error);
    ws.close(1011, 'WebSocket error');
  }

  scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(async () => {
      try {
        await this.saveToStorage();
      } catch (err) {
        console.error('Error saving Yjs state to DO storage:', err);
      }
    }, 2000);
  }

  async saveToStorage() {
    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      await this.ctx.storage.put('yjsState', state);
    } catch (err) {
      console.error('Failed to write Yjs state to DO storage:', err);
    }
  }
}
