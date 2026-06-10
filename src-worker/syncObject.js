import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { verify } from 'hono/jwt';
import {
  AppError,
  LIMITS,
  assertDocumentReadable,
  getDocumentAccess,
  requireDb,
  requireJwtSecret,
  validateTitle,
  validateUuid,
} from './security.js';

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;
const WS_OPEN = 1;

function textResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function uint8ArrayToBase64(arr) {
  let binary = '';
  const len = arr.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function normalizeWebSocketMessage(data) {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  return null;
}

export class DocumentSyncObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.doc = null;
    this.conns = new Map(); // Map<WebSocket, Meta>
    this.saveTimeout = null;
  }

  async getDoc(docId) {
    if (this.doc) return this.doc;

    const db = requireDb(this.env);
    this.doc = new Y.Doc();
    this.doc.conns = this.conns;

    // Load initial state from D1
    try {
      const row = await db
        .prepare('SELECT yjsState FROM documents WHERE id = ?')
        .bind(docId)
        .first();

      if (row && row.yjsState) {
        const binaryState = base64ToUint8Array(row.yjsState);
        Y.applyUpdate(this.doc, binaryState);
        console.log(`[DO] Loaded ${binaryState.byteLength} bytes from D1 for doc ${docId}`);
      }
    } catch (err) {
      console.error('[DO] Error loading state from D1:', err);
    }

    // Set up update handler
    this.doc.on('update', (update, origin) => {
      // Broadcast to other connected clients
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      this.conns.forEach((meta, clientWs) => {
        if (origin !== clientWs && clientWs.readyState === WS_OPEN) {
          this.safeSend(clientWs, message, docId, meta, 'document-update');
        }
      });

      // Schedule save to D1
      this.scheduleSave(docId);
    });

    return this.doc;
  }

  scheduleSave(docId) {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.saveNow(docId), 2000);
  }

  async saveNow(docId) {
    const db = requireDb(this.env);
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (!this.doc) return;

    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      const stateBase64 = uint8ArrayToBase64(state);

      const meta = this.doc.getMap('meta');
      let title = 'Untitled document';
      try {
        title = validateTitle(meta.get('title') || 'Untitled document');
      } catch {
        title = 'Untitled document';
      }

      const pages = this.doc.getArray('pages');
      let previewContent = '';
      if (pages.length > 0) {
        const firstPage = pages.get(0);
        if (firstPage && typeof firstPage.get === 'function') {
          const content = firstPage.get('content');
          if (content && typeof content.toString === 'function') {
            previewContent = content.toString();
          }
        }
      }

      await db
        .prepare(
          "UPDATE documents SET yjsState = ?, title = ?, lastModified = datetime('now') WHERE id = ?"
        )
        .bind(stateBase64, title, docId)
        .run();

      if (previewContent !== '') {
        await db.prepare('DELETE FROM document_pages WHERE documentId = ?').bind(docId).run();
        await db
          .prepare('INSERT INTO document_pages (documentId, pageIndex, content) VALUES (?, 0, ?)')
          .bind(docId, previewContent.substring(0, 500))
          .run();
      }
      console.log(`[DO] Saved state to D1 for doc ${docId}`);
    } catch (err) {
      console.error('[DO] Error saving document state to D1:', err);
    }
  }

  async verifyWsTicket(ticket) {
    try {
      const jwtSecret = requireJwtSecret(this.env);
      const decoded = await verify(ticket, jwtSecret, 'HS256');
      if (decoded.type !== 'ws-ticket') return null;
      return {
        userId: decoded.sub,
        username: decoded.username,
        sessionId: decoded.sessionId,
      };
    } catch {
      return null;
    }
  }

  getSocketLogContext(type, event, ws, docId, meta) {
    return {
      eventType: type,
      closeCode: typeof event?.code === 'number' ? event.code : null,
      closeReason: event?.reason || '',
      wasClean: typeof event?.wasClean === 'boolean' ? event.wasClean : null,
      readyState: ws?.readyState ?? null,
      documentId: docId,
      clientId: meta?.clientId || null,
      sessionId: meta?.sessionId || null,
      userId: meta?.userId || null,
      username: meta?.username || null,
      activeConnections: this.conns.size,
      message: event?.message || null,
    };
  }

  safeSend(ws, message, docId, meta, label) {
    if (ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(message);
      return true;
    } catch (err) {
      console.error('[DO] WebSocket send failed', {
        ...this.getSocketLogContext('send-error', err, ws, docId, meta),
        label,
      });
      this.conns.delete(ws);
      try {
        ws.close(1011, 'Send failed');
      } catch {}
      return false;
    }
  }

  safeClose(ws, code, reason) {
    try {
      if (ws.readyState === WS_OPEN || ws.readyState === 0) {
        ws.close(code, reason);
      }
    } catch {}
  }

  async fetch(request) {
    let docId;
    try {
      const url = new URL(request.url);
      docId = validateUuid(url.pathname.split('/').pop(), 'document id');

      const ticket = url.searchParams.get('ticket');
      if (!ticket) {
        return textResponse('Unauthorized: Ticket missing', 401);
      }

      const ticketInfo = await this.verifyWsTicket(ticket);
      if (!ticketInfo) {
        return textResponse('Unauthorized: Invalid or expired ticket', 401);
      }

      const { userId, username, sessionId } = ticketInfo;
      const db = requireDb(this.env);
      const access = await getDocumentAccess(db, docId, userId);
      assertDocumentReadable(access);

      const readOnly = !access.canEdit;

      // Upgrade connection
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);

      await this.handleConnection(server, docId, userId, username, readOnly, sessionId);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    } catch (err) {
      if (err instanceof AppError) {
        return textResponse(err.message, err.status);
      }
      console.error('[DO] Failed to establish websocket:', {
        message: err && err.message ? err.message : 'Unknown error',
      });
      return textResponse('Internal Server Error', 500);
    }
  }

  async handleConnection(ws, docId, userId, username, readOnly, sessionId = null) {
    ws.binaryType = 'arraybuffer';
    ws.accept();
    const doc = await this.getDoc(docId);
    const meta = {
      userId,
      username,
      sessionId,
      readOnly,
      clientId: createClientId(),
      docId,
    };

    // Register connection
    this.conns.set(ws, meta);

    // Send Sync Step 1 (Server State Vector)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    this.safeSend(ws, encoding.toUint8Array(encoder), docId, meta, 'initial-sync-step1');
    console.log('[DO] Sent initial sync step', {
      documentId: docId,
      clientId: meta.clientId,
      sessionId: meta.sessionId,
      userId: meta.userId,
      readyState: ws.readyState,
    });

    // Handle messages
    ws.addEventListener('message', async (event) => {
      try {
        const message = await normalizeWebSocketMessage(event.data);
        if (!message) {
          console.warn('[DO] Closing WebSocket for unsupported message type', {
            ...this.getSocketLogContext('message', event, ws, docId, meta),
            dataType: event.data === null ? 'null' : typeof event.data,
          });
          this.safeClose(ws, 1003, 'Unsupported message type');
          return;
        }

        if (message.byteLength === 0) {
          console.warn('[DO] Closing WebSocket for empty message', {
            ...this.getSocketLogContext('message', event, ws, docId, meta),
            byteLength: message.byteLength,
          });
          this.safeClose(ws, 1003, 'Empty message');
          return;
        }

        if (message.byteLength > LIMITS.websocketMessage) {
          console.warn('[DO] Closing WebSocket for oversized message', {
            ...this.getSocketLogContext('message', event, ws, docId, meta),
            byteLength: message.byteLength,
          });
          this.safeClose(ws, 1009, 'Message too large');
          return;
        }

        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);

        switch (messageType) {
          case messageSync: {
            const syncEncoder = encoding.createEncoder();
            encoding.writeVarUint(syncEncoder, messageSync);

            if (readOnly) {
              const syncMessageType = decoding.peekVarUint(decoder);
              if (syncMessageType === 2) {
                // Ignore updates from viewers
                return;
              }
            }

            syncProtocol.readSyncMessage(decoder, syncEncoder, doc, ws);
            if (encoding.length(syncEncoder) > 1) {
              this.safeSend(ws, encoding.toUint8Array(syncEncoder), docId, meta, 'sync-response');
            }
            break;
          }
          case messageAwareness: {
            // Propagate awareness updates
            const awarenessUpdate = decoding.readVarUint8Array(decoder);
            this.conns.forEach((clientMeta, clientWs) => {
              if (clientWs !== ws && clientWs.readyState === WS_OPEN) {
                const awarenessEncoder = encoding.createEncoder();
                encoding.writeVarUint(awarenessEncoder, messageAwareness);
                encoding.writeVarUint8Array(awarenessEncoder, awarenessUpdate);
                this.safeSend(
                  clientWs,
                  encoding.toUint8Array(awarenessEncoder),
                  docId,
                  clientMeta,
                  'awareness-update'
                );
              }
            });
            break;
          }
          case messageQueryAwareness:
            break;
          default:
            console.warn('[DO] Closing WebSocket for unknown message type', {
              ...this.getSocketLogContext('message', event, ws, docId, meta),
              messageType,
            });
            this.safeClose(ws, 1003, 'Unknown message type');
            break;
        }
      } catch (err) {
        console.error('[DO] Error handling message:', {
          ...this.getSocketLogContext('message-error', err, ws, docId, meta),
          message: err && err.message ? err.message : 'Unknown error',
        });
        this.safeClose(ws, 1003, 'Malformed message');
      }
    });

    ws.addEventListener('close', (event) => {
      const closeMeta = this.conns.get(ws) || meta;
      console.log(
        '[DO] WebSocket close',
        this.getSocketLogContext('close', event, ws, docId, closeMeta)
      );
      this.conns.delete(ws);
      if (this.conns.size === 0) {
        this.saveNow(docId).catch((err) => {
          console.error('[DO] Error saving after WebSocket close:', {
            ...this.getSocketLogContext('close-save-error', err, ws, docId, closeMeta),
            message: err && err.message ? err.message : 'Unknown error',
          });
        });
      }
    });

    ws.addEventListener('error', (event) => {
      console.error(
        '[DO] WebSocket error',
        this.getSocketLogContext('error', event, ws, docId, meta)
      );
    });
  }
}
