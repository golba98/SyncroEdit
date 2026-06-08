// tests/setup.js

// Check if we are in a Node.js environment (Backend Tests)
// In jsdom (Frontend Tests), window is defined.
const isNodeEnv = typeof window === 'undefined';

jest.setTimeout(120000);

if (isNodeEnv) {
  // Mock CSRF protection for backend integration tests
  jest.mock('../src/utils/csrf', () => require('./mocks/csrf'));
}

let mongoose;
let MongoMemoryServer;
let server;
let wss;
let User;
let Document;
let History;
let mongoServer;
let documentSocket;

if (isNodeEnv) {
  // Only load server and models if we are NOT skipping DB setup (Integration Tests)
  // For Unit Tests (SKIP_DB_SETUP=true), we want to avoid loading these to prevent
  // module caching that interferes with mocking.
  if (!process.env.SKIP_DB_SETUP) {
    mongoose = require('mongoose');
    MongoMemoryServer = require('mongodb-memory-server').MongoMemoryServer;

    const serverModule = require('../src/server');
    server = serverModule.server;
    wss = serverModule.wss;
    documentSocket = require('../src/documents/socket');
    User = require('../src/users/User');
    Document = require('../src/documents/Document');
    History = require('../src/documents/History');
  }
} else {
  // Frontend Test Environment Setup
  window.testEnv = true;
}

beforeAll(async () => {
  if (!isNodeEnv || process.env.SKIP_DB_SETUP) return;

  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
});

afterAll(async () => {
  if (!isNodeEnv || process.env.SKIP_DB_SETUP) return;

  if (documentSocket && typeof documentSocket.__clearForTests === 'function') {
    documentSocket.__clearForTests();
  }
  if (wss) {
    wss.clients.forEach((client) => client.terminate());
    await new Promise((resolve) => wss.close(resolve));
  }
  if (server && server.listening) {
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  await mongoose.connection.close();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  if (!isNodeEnv || process.env.SKIP_DB_SETUP) return;

  if (mongoose.connection.readyState !== 0) {
    await User.deleteMany({});
    await Document.deleteMany({});
    await History.deleteMany({});
  }
});
