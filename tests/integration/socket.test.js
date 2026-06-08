const WebSocket = require('ws');
const { server } = require('../../src/server');
const Document = require('../../src/documents/Document');
const User = require('../../src/users/User');
const { createTicket } = require('../../src/utils/ticketStore');

// No mocks for internal modules, use real server behavior (integration)

describe('Socket Logic Integration Tests', () => {
  let baseUrl;
  let userId;
  let docId;
  let validTicket;

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
    // Server closing is handled by setup.js usually, but we can ensure it here
    // setup.js closes it if it started it. Here we might have started it.
    // To be safe, we don't close if setup.js handles it, OR we close if we started it.
    // Currently setup.js closes server if listening.
  });

  beforeEach(async () => {
    // Setup.js clears DB.
    // Create User and Doc
    const user = await User.create({
      username: 'socketuser',
      email: 'socket@test.com',
      password: 'Password123!',
    });
    userId = user._id.toString();

    const doc = await Document.create({
      title: 'Socket Doc',
      owner: userId,
      sharedWith: [],
    });
    docId = doc._id.toString();

    // Create REAL ticket
    validTicket = createTicket(userId);
  });

  function createWebSocket(query) {
    return new WebSocket(`${baseUrl}${query}`);
  }

  it('should reject connection without ticket', (done) => {
    const ws = createWebSocket(`?documentId=${docId}`);
    ws.on('error', () => {});
    ws.on('close', (code) => {
      // Expecting non-normal closure or error, practically just closed.
      done();
    });
  });

  it('should reject connection with invalid ticket', (done) => {
    const ws = createWebSocket(`?documentId=${docId}&ticket=invalid`);
    ws.on('error', () => {});
    ws.on('close', () => {
      done();
    });
  });

  it('should accept connection with valid ticket', (done) => {
    const ws = createWebSocket(`?documentId=${docId}&ticket=${validTicket}`);

    ws.on('open', () => {
      ws.close();
      done();
    });

    ws.on('error', (err) => {
      done(err);
    });
  });
});
