import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { verify } from 'hono/jwt';

const messageSync = 0;
const messageAwareness = 1;

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

    this.doc = new Y.Doc();
    this.doc.conns = this.conns;

    // Load initial state from D1
    try {
      const row = await this.env.DB.prepare('SELECT yjsState FROM documents WHERE id = ?')
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
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (!this.doc) return;

    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      const stateBase64 = uint8ArrayToBase64(state);

      const meta = this.doc.getMap('meta');
      const title = meta.get('title') || 'Untitled document';

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

      await this.env.DB.prepare(
        "UPDATE documents SET yjsState = ?, title = ?, lastModified = datetime('now') WHERE id = ?"
      )
        .bind(stateBase64, title, docId)
        .run();

      if (previewContent !== '') {
        await this.env.DB.prepare('DELETE FROM document_pages WHERE documentId = ?')
          .bind(docId)
          .run();
        await this.env.DB.prepare(
          'INSERT INTO document_pages (documentId, pageIndex, content) VALUES (?, 0, ?)'
        )
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
      const jwtSecret = this.env.JWT_SECRET || 'dev-secret-key';
      const decoded = await verify(ticket, jwtSecret, 'HS256');
      if (decoded.type !== 'ws-ticket') return null;
      return { userId: decoded.sub, username: decoded.username };
    } catch {
      return null;
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const docId = url.pathname.split('/').pop();

    const ticket = url.searchParams.get('ticket');
    if (!ticket) {
      return new Response('Unauthorized: Ticket missing', { status: 401 });
    }

    const ticketInfo = await this.verifyWsTicket(ticket);
    if (!ticketInfo) {
      return new Response('Unauthorized: Invalid or expired ticket', { status: 401 });
    }

    const { userId, username } = ticketInfo;

    // Check permissions
    const docInfo = await this.env.DB.prepare('SELECT owner, isPublic FROM documents WHERE id = ?')
      .bind(docId)
      .first();

    if (!docInfo) {
      return new Response('Document not found', { status: 404 });
    }

    const isOwner = docInfo.owner === userId;
    const permission = await this.env.DB.prepare(
      'SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?'
    )
      .bind(docId, userId)
      .first();

    const isShared = permission && permission.role === 'editor';
    const isViewer = permission && permission.role === 'viewer';
    const isPublic = docInfo.isPublic === 1;

    if (!isOwner && !isShared && !isViewer && !isPublic) {
      return new Response('Forbidden', { status: 403 });
    }

    const readOnly = isViewer && !isOwner && !isShared;

    // Upgrade connection
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    await this.handleConnection(server, docId, userId, username, readOnly);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
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
        const message = new Uint8Array(event.data);
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
        }
      } catch (err) {
        console.error('[DO] Error handling message:', err);
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
