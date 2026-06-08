const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const User = require('../users/User');
const Document = require('./Document');
const { logHistory } = require('../utils/history');
const logger = require('../utils/logger');
const { verifyTicket } = require('../utils/ticketStore');

const JWT_SECRET = process.env.JWT_SECRET;

// Store active Y.Docs: documentId -> Y.Doc
const docs = new Map();
const evictionTimeouts = new Set();

// Helper: Setup a Y.Doc with persistence
async function getOrCreateDoc(documentId, gc = true) {
  if (docs.has(documentId)) {
    return docs.get(documentId);
  }

  const doc = new Y.Doc({ gc });
  doc.conns = new Map(); // Map<WebSocket, Set<number>> - track imported scripts per client if needed
  docs.set(documentId, doc);

  // Load from MongoDB
  if (mongoose.connection.readyState === 1) {
    try {
      // FIX: Explicitly select yjsState because it's select:false in Schema
      const dbDoc = await Document.findById(documentId).select('+yjsState');
      if (dbDoc && dbDoc.yjsState) {
        // Binary Optimization: Apply state directly from Buffer
        const state = Buffer.from(dbDoc.yjsState, 'base64');
        Y.applyUpdate(doc, state);
        console.log(`[Binary Optimization] Loaded ${state.length} bytes for doc ${documentId}`);
      }
    } catch (e) {
      logger.error('Error loading document state:', e);
    }
  }

  // Setup Persistence (Debounced Save)
  let saveTimeout = null;
  const saveToDB = async () => {
    if (mongoose.connection.readyState !== 1) return;
    const state = Y.encodeStateAsUpdate(doc);
    const stateBase64 = Buffer.from(state).toString('base64');

    // Extract Metadata
    const meta = doc.getMap('meta');
    const title = meta.get('title');

    // Extract Content for Preview
    const pages = doc.getArray('pages');
    let previewContent = '';
    // Iterate to get text from all pages or just first?
    // For preview/search, getting at least the first page is good.
    if (pages.length > 0) {
      const firstPage = pages.get(0);
      // Ensure it's a Y.Map and has 'content' (Y.Text)
      if (firstPage && firstPage.get) {
        const content = firstPage.get('content');
        if (content && typeof content.toString === 'function') {
          previewContent = content.toString();
        }
      }
    }

    const updateData = {
      yjsState: stateBase64,
      lastModified: new Date(),
    };

    if (title) updateData.title = title;

    // Save preview content to pages[0]
    // This allows the file list to show a snippet or at least search to work
    if (previewContent || previewContent === '') {
      updateData.pages = [{ content: previewContent.substring(0, 500) }]; // Limit preview size
    }

    try {
      await Document.findByIdAndUpdate(documentId, updateData);
    } catch (e) {
      logger.error('Error saving document state:', e);
    }
  };

  doc.on('update', (update, origin) => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveToDB, 2000); // Save every 2 seconds of inactivity
    if (typeof saveTimeout.unref === 'function') saveTimeout.unref();

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    doc.conns.forEach((_, c) => {
      if (origin !== c && c.readyState === WebSocket.OPEN) {
        c.send(message);
      }
    });
  });

  return doc;
}

const messageSync = 0;
const messageAwareness = 1;

function init(server) {
  const wss = new WebSocket.Server({ noServer: true });

  // Heartbeat to keep connections alive (especially on cloud providers like Render)
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
  if (typeof interval.unref === 'function') interval.unref();

  wss.on('close', () => clearInterval(interval));

  server.on('upgrade', async (request, socket, head) => {
    // Parse URL for documentId and token/ticket
    // Expected format: /ws/:docId?token=... OR /?documentId=...
    const url = new URL(request.url, 'http://localhost');
    let documentId = url.searchParams.get('documentId');
    const token = url.searchParams.get('token');
    const ticket = url.searchParams.get('ticket');

    // Support dedicated path /ws/:docId
    // Robust extraction: Handle /ws/docId (direct) or /docId (proxy stripped)
    if (!documentId) {
      const parts = url.pathname.split('/').filter((p) => p.trim().length > 0);
      if (parts.length > 0) {
        documentId = parts[parts.length - 1];
      }
    }

    if (!documentId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    let userId = null;

    // Authentication Strategy: Ticket (Preferred) > Token
    if (ticket) {
      userId = verifyTicket(ticket);
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    } else if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id;
      } catch (err) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    } else {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Check Document Access
    try {
      const dbDoc = await Document.findById(documentId);
      if (!dbDoc) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const isOwner = dbDoc.owner.toString() === userId;
      const isShared = dbDoc.sharedWith && dbDoc.sharedWith.some((id) => id.toString() === userId);
      const isViewer = dbDoc.viewers && dbDoc.viewers.some((id) => id.toString() === userId);

      // Allow if public, but maybe we want to enforce read-only for public?
      // For now, let's assume public means "collaborate" based on the UI text.
      // If we wanted public read-only, we'd check dbDoc.isPublic and set readOnly = true.
      // But the modal says "Anyone with this link can collaborate".
      const isPublic = dbDoc.isPublic === true;

      if (!isOwner && !isShared && !isViewer && !isPublic) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const readOnly = (isViewer && !isOwner && !isShared) || (isPublic && false); // Future proofing logic

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.isAlive = true;
        ws.readOnly = readOnly; // Attach flag
        ws.on('pong', () => (ws.isAlive = true));
        wss.emit('connection', ws, request, { documentId, userId }); // Pass userId
      });
    } catch (e) {
      logger.error('Auth error during upgrade:', e);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', async (conn, req, { documentId, userId }) => {
    console.log(`Client connected to doc: ${documentId} (User: ${userId})`);
    const doc = await getOrCreateDoc(documentId);

    // Setup Awareness (Cursors)
    // We create an awareness instance for this connection
    // Note: In standard y-websocket, awareness is shared via the doc.
    // Here we manually handle the protocol.

    conn.binaryType = 'arraybuffer';

    // Initialize Sync
    // Optimization: Standard Yjs protocol exchange
    // 1. Server sends SyncStep1 (Server State Vector)
    // 2. Client receives, calculates diff, sends SyncStep2 (Missing updates) AND SyncStep1 (Client State Vector)
    // 3. Server receives, sends SyncStep2 (Missing updates for client)

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    conn.send(encoding.toUint8Array(encoder));

    // Handle incoming messages
    conn.on('message', (message) => {
      try {
        const encoder = encoding.createEncoder();
        const decoder = decoding.createDecoder(new Uint8Array(message));
        const messageType = decoding.readVarUint(decoder);
        // console.log(`Received message type: ${messageType} from doc: ${documentId}`);

        switch (messageType) {
          case messageSync:
            encoding.writeVarUint(encoder, messageSync);

            // Peek at sync message type to enforce Read-Only
            // y-protocols: 0=Step1, 1=Step2, 2=Update
            if (conn.readOnly) {
              const syncMessageType = decoding.peekVarUint(decoder);
              if (syncMessageType === 2) {
                // Update
                // Ignore updates from viewers
                return;
              }
            }

            syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
            if (encoding.length(encoder) > 1) {
              conn.send(encoding.toUint8Array(encoder));
            }
            break;
          case messageAwareness:
            // Propagate awareness updates to all other clients
            // Simple relay for now
            const awarenessUpdate = decoding.readVarUint8Array(decoder);
            docs.get(documentId).conns.forEach((_, c) => {
              if (c !== conn && c.readyState === WebSocket.OPEN) {
                const awarenessEncoder = encoding.createEncoder();
                encoding.writeVarUint(awarenessEncoder, messageAwareness);
                encoding.writeVarUint8Array(awarenessEncoder, awarenessUpdate);
                c.send(encoding.toUint8Array(awarenessEncoder));
              }
            });
            break;
        }
      } catch (err) {
        logger.error('Error handling message:', err);
      }
    });

    // Register connection
    if (!doc.conns.has(conn)) {
      doc.conns.set(conn, new Set());
    }

    conn.on('close', () => {
      doc.conns.delete(conn);
      if (doc.conns.size === 0) {
        // Implementation of Server-Side Memory Eviction
        // If all clients disconnected, schedule doc removal from memory
        // Grace period (e.g. 10s) to handle page refreshes or quick re-entry
        const evictionTimeout = setTimeout(() => {
          evictionTimeouts.delete(evictionTimeout);
          const currentDoc = docs.get(documentId);
          if (currentDoc && currentDoc.conns.size === 0) {
            console.log(`[Memory Management] Unloading doc ${documentId} due to inactivity.`);
            // Force a final save if there's a pending update
            // The doc.on('update') already has a saveTimeout, but we want to be safe.
            docs.delete(documentId);
          }
        }, 10000);
        if (typeof evictionTimeout.unref === 'function') evictionTimeout.unref();
        evictionTimeouts.add(evictionTimeout);
      }
    });
  });

  return wss;
}

function notifyDocumentDeleted(documentId) {
  // ...
}

function broadcastMaintenance(wss) {
  // ...
}

function __clearForTests() {
  evictionTimeouts.forEach((timeout) => clearTimeout(timeout));
  evictionTimeouts.clear();
  docs.clear();
}

module.exports = { init, notifyDocumentDeleted, broadcastMaintenance, __clearForTests };
