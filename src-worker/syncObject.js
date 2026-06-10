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
        if (origin !== clientWs && clientWs.readyState === 1) {
          // 1 = OPEN
          try {
            clientWs.send(message);
          } catch (e) {
            console.error('[DO] Error sending update:', e);
          }
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
      return { userId: decoded.sub, username: decoded.username };
    } catch {
      return null;
    }
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

      const { userId, username } = ticketInfo;
      const db = requireDb(this.env);
      const access = await getDocumentAccess(db, docId, userId);
      assertDocumentReadable(access);

      const readOnly = !access.canEdit;

      // Upgrade connection
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);

      await this.handleConnection(server, docId, userId, username, readOnly);

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

  async handleConnection(ws, docId, userId, username, readOnly) {
    ws.accept();
    const doc = await this.getDoc(docId);

    // Register connection
    this.conns.set(ws, { userId, username, readOnly });

    // Send Sync Step 1 (Server State Vector)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));

    // Handle messages
    ws.addEventListener('message', async (event) => {
      try {
        let message;
        if (event.data instanceof ArrayBuffer) {
          message = new Uint8Array(event.data);
        } else if (event.data instanceof Uint8Array) {
          message = event.data;
        } else {
          ws.close(1003, 'Unsupported message type');
          return;
        }

        if (message.byteLength === 0 || message.byteLength > LIMITS.websocketMessage) {
          ws.close(1009, 'Message too large');
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
              ws.send(encoding.toUint8Array(syncEncoder));
            }
            break;
          }
          case messageAwareness: {
            // Propagate awareness updates
            const awarenessUpdate = decoding.readVarUint8Array(decoder);
            this.conns.forEach((meta, clientWs) => {
              if (clientWs !== ws && clientWs.readyState === 1) {
                const awarenessEncoder = encoding.createEncoder();
                encoding.writeVarUint(awarenessEncoder, messageAwareness);
                encoding.writeVarUint8Array(awarenessEncoder, awarenessUpdate);
                clientWs.send(encoding.toUint8Array(awarenessEncoder));
              }
            });
            break;
          }
          default:
            ws.close(1003, 'Unknown message type');
            break;
        }
      } catch (err) {
        console.error('[DO] Error handling message:', {
          message: err && err.message ? err.message : 'Unknown error',
        });
        try {
          ws.close(1003, 'Malformed message');
        } catch {}
      }
    });

    ws.addEventListener('close', () => {
      this.conns.delete(ws);
      if (this.conns.size === 0) {
        this.saveNow(docId);
      }
    });

    ws.addEventListener('error', (err) => {
      console.error('[DO] WebSocket error:', err);
    });
  }
}
