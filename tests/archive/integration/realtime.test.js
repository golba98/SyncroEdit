const WebSocket = require('ws');
const { server } = require('../../src/server');
const Document = require('../../src/documents/Document');
const User = require('../../src/users/User');
const { createTicket } = require('../../src/utils/ticketStore');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

describe('Real-time Collaboration Tests', () => {
  let baseUrl;
  let ownerId, editorId, viewerId;
  let docId;
  let ownerTicket, editorTicket, viewerTicket;
  let clients = [];
  let awarenessInstances = [];

  beforeAll((done) => {
    if (!server.listening) {
      server.listen(0, () => {
        const port = server.address().port;
        baseUrl = `ws://localhost:${port}`;
        done();
      });
    } else {
      const port = server.address().port;
      baseUrl = `ws://localhost:${port}`;
      done();
    }
  });

  afterAll(async () => {
    // Server close handled by setup.js
  });

  afterEach(async () => {
    await Promise.all(
      clients.map(
        (client) =>
          new Promise((resolve) => {
            if (client.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }

            client.once('close', resolve);
            client.terminate();
          })
      )
    );
    clients = [];
    awarenessInstances.forEach((awareness) => awareness.destroy());
    awarenessInstances = [];
  });

  beforeEach(async () => {
    // DB cleared by setup.js
    const owner = await User.create({
      username: 'owner',
      email: 'owner@test.com',
      password: 'Password123!',
    });
    const editor = await User.create({
      username: 'editor',
      email: 'editor@test.com',
      password: 'Password123!',
    });
    const viewer = await User.create({
      username: 'viewer',
      email: 'viewer@test.com',
      password: 'Password123!',
    });

    ownerId = owner._id.toString();
    editorId = editor._id.toString();
    viewerId = viewer._id.toString();

    const doc = await Document.create({
      title: 'Realtime Doc',
      owner: ownerId,
      sharedWith: [editorId],
      viewers: [viewerId],
    });
    docId = doc._id.toString();

    ownerTicket = createTicket(ownerId);
    editorTicket = createTicket(editorId);
    viewerTicket = createTicket(viewerId);
  });

  function createClient(ticket) {
    const client = new WebSocket(`${baseUrl}?documentId=${docId}&ticket=${ticket}`);
    clients.push(client);
    return client;
  }

  it('should allow editors to sync updates (Conflict Resolution)', (done) => {
    const client1 = createClient(ownerTicket);
    const client2 = createClient(editorTicket);

    let client1Doc = new Y.Doc();
    let client2Doc = new Y.Doc();

    let c1Connected = false;

    const sendSync = (ws, doc) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // messageSync
      syncProtocol.writeSyncStep1(encoder, doc);
      ws.send(encoding.toUint8Array(encoder));
    };

    const handleMessage = (doc, data) => {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const messageType = decoding.readVarUint(decoder);
        if (messageType === 0) {
          // messageSync
          const syncMessageType = decoding.peekVarUint(decoder);
          console.log(
            `[DEBUG] Received Sync Message Type: ${syncMessageType} (0=Step1, 1=Step2, 2=Update)`
          );

          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, doc, null);
        }
      } catch (e) {
        console.error('Error handling message', e);
      }
    };

    client1.on('open', () => {
      console.log('Client 1 Open');
      c1Connected = true;
      sendSync(client1, client1Doc);
    });

    client2.on('open', () => {
      console.log('Client 2 Open');
      sendSync(client2, client2Doc);
    });

    let updatesReceived = 0;

    const checkConvergence = () => {
      const text1 = client1Doc.getText('content').toString();
      const text2 = client2Doc.getText('content').toString();

      console.log(`Convergence Check: "${text1}" vs "${text2}"`);

      if (text1.length === 2 && text2.length === 2) {
        // Wait a tick to ensure stable state
        setTimeout(() => {
          try {
            expect(text1).toEqual(text2);
            client1.close();
            client2.close();
            done();
          } catch (e) {
            done(e);
          }
        }, 100);
      }
    };

    client1.on('message', (data) => {
      // console.log('Client 1 Message');
      handleMessage(client1Doc, data);
      if (c1Connected) {
        console.log('Client 1 Inserting "A"');
        client1Doc.getText('content').insert(0, 'A');
        const update = Y.encodeStateAsUpdate(client1Doc);

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.writeUpdate(encoder, update);
        client1.send(encoding.toUint8Array(encoder));
        c1Connected = false;
      }
      checkConvergence();
    });

    client2.on('message', (data) => {
      // console.log('Client 2 Message');
      handleMessage(client2Doc, data);
      if (client2Doc.getText('content').toString() === '' && updatesReceived === 0) {
        console.log('Client 2 Inserting "B"');
        client2Doc.getText('content').insert(0, 'B');
        const update = Y.encodeStateAsUpdate(client2Doc);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.writeUpdate(encoder, update);
        client2.send(encoding.toUint8Array(encoder));
        updatesReceived++;
      }
      checkConvergence();
    });
  }, 10000); // Increased timeout

  it('should prevent viewers from broadcasting changes', (done) => {
    const viewerClient = createClient(viewerTicket);
    const editorClient = createClient(editorTicket);

    let editorDoc = new Y.Doc();

    viewerClient.on('open', () => {
      console.log('Viewer Client Open');
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // messageSync

      const doc = new Y.Doc();
      doc.getText('content').insert(0, 'ViewerHack');
      const update = Y.encodeStateAsUpdate(doc);

      syncProtocol.writeUpdate(encoder, update);
      viewerClient.send(encoding.toUint8Array(encoder));
    });

    editorClient.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType === 0) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.readSyncMessage(decoder, encoder, editorDoc, null);

        if (editorDoc.getText('content').toString().includes('ViewerHack')) {
          viewerClient.close();
          editorClient.close();
          done(new Error('Viewer update was applied!'));
        }
      }
    });

    setTimeout(() => {
      if (!editorDoc.getText('content').toString().includes('ViewerHack')) {
        viewerClient.close();
        editorClient.close();
        done();
      }
    }, 2000); // Wait long enough for potential update to arrive
  });

  it('should propagate awareness (Presence)', (done) => {
    const c1 = createClient(ownerTicket);
    const c2 = createClient(editorTicket);

    c1.on('open', () => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1); // messageAwareness

      const awareness = new awarenessProtocol.Awareness(new Y.Doc());
      awarenessInstances.push(awareness);
      awareness.setLocalState({ user: { name: 'Owner' } });
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);

      encoding.writeVarUint8Array(encoder, update);
      c1.send(encoding.toUint8Array(encoder));
    });

    c2.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType === 1) {
        decoding.readVarUint8Array(decoder);
        c1.close();
        c2.close();
        done();
      }
    });
  });
});
