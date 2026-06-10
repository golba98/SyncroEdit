/**
 * @jest-environment jsdom
 */

import * as Y from 'yjs';
import { get } from 'idb-keyval';

// Mocks
jest.mock('idb-keyval');
const mockProviderInstances = [];
const mockQuillBinding = jest.fn().mockImplementation(() => ({
  destroy: jest.fn(),
}));

function createMockProvider(serverUrl, roomname, doc, opts = {}) {
  const handlers = {};
  const provider = {
    serverUrl,
    roomname,
    doc,
    params: opts.params || {},
    shouldConnect: Boolean(opts.connect),
    wsconnected: false,
    wsconnecting: false,
    synced: false,
    ws: null,
    awareness: {
      setLocalStateField: jest.fn(),
      on: jest.fn(),
      getStates: jest.fn().mockReturnValue(new Map()),
    },
    on: jest.fn((eventName, handler) => {
      handlers[eventName] = handler;
    }),
    emit: (eventName, ...args) => {
      if (handlers[eventName]) handlers[eventName](...args);
    },
    connect: jest.fn(() => {
      provider.shouldConnect = true;
      provider.wsconnecting = true;
    }),
    destroy: jest.fn(() => {
      provider.shouldConnect = false;
      provider.wsconnected = false;
      provider.wsconnecting = false;
    }),
  };
  mockProviderInstances.push(provider);
  return provider;
}

const mockQuillInstance = {
  on: jest.fn(),
  getSelection: jest.fn(),
  getLength: jest.fn().mockReturnValue(1),
  setSelection: jest.fn(),
  focus: jest.fn(),
  formatText: jest.fn(),
  root: document.createElement('div'),
};

global.Quill = jest.fn().mockImplementation(() => mockQuillInstance);
global.Quill.import = jest.fn().mockImplementation((path) => {
  if (path === 'parchment') {
    return {
      Attributor: {
        Style: jest.fn().mockImplementation(() => ({
          // mock methods if needed
        })),
      },
      Scope: { INLINE: 'inline' },
    };
  }
  return { whitelist: [] };
});
global.Quill.register = jest.fn();

// Fix JSDOM missing scrollIntoView
Element.prototype.scrollIntoView = jest.fn();
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));
global.requestIdleCallback = global.requestIdleCallback || ((callback) => setTimeout(callback, 0));

describe('Editor Lifecycle & Resilience', () => {
  let Editor;

  beforeAll(() => {
    global.__mockWebsocketProvider = createMockProvider;
    global.__mockQuillBinding = mockQuillBinding;
    ({ Editor } = require('/js/features/editor/editor.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockProviderInstances.length = 0;
    global.__mockWebsocketProvider = createMockProvider;
    global.__mockQuillBinding = mockQuillBinding;
    document.body.innerHTML = '<div id="editor-container"></div><input id="docTitle">';

    // Mock URL search params
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('test-doc'),
    }));

    // Mock fetch for WS ticket
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ ticket: 'mock-ticket' }),
    });
    get.mockResolvedValue(undefined);
  });

  it('should render from cache before WebSocket is connected', async () => {
    const mockDoc = new Y.Doc();
    const pages = mockDoc.getArray('pages');
    const pageMap = new Y.Map();
    pageMap.set('content', new Y.Text('Cached Content'));
    pages.push([pageMap]);
    const cachedUpdate = Y.encodeStateAsUpdate(mockDoc);

    get.mockResolvedValue(cachedUpdate);

    new Editor('editor-container');

    // Wait for loadFromCache
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(get).toHaveBeenCalledWith('doc-store-test-doc');
    const pageEditors = document.querySelectorAll('.page-editor');
    expect(pageEditors.length).toBeGreaterThan(0);
  });

  it('should not throw error if provider is not ready during page mounting', async () => {
    const editor = new Editor('editor-container');
    editor.provider = null; // Simulate provider not ready yet

    const pageMap = new Y.Map();
    pageMap.set('id', 'page1');
    pageMap.set('content', new Y.Text('Test'));
    editor.yPages.push([pageMap]);
    editor.createPageContainer('page1', 0);

    // This should NOT throw "Cannot read properties of null (reading 'awareness')"
    // because of our fix in editor.js
    expect(() => {
      editor.mountPage('page1');
    }).not.toThrow();

    expect(mockQuillBinding).not.toHaveBeenCalled();
  });

  it('does not configure Start typing placeholder before editor is ready', async () => {
    const editor = new Editor('editor-container');
    editor.provider = null;

    const pageMap = new Y.Map();
    pageMap.set('id', 'page-ready-test');
    pageMap.set('content', new Y.Text(''));
    editor.yPages.push([pageMap]);
    editor.createPageContainer('page-ready-test', 0);
    editor.mountPage('page-ready-test');

    const lastQuillCall = global.Quill.mock.calls.at(-1);
    expect(lastQuillCall[1].placeholder).toBe('');
    expect(document.body.textContent).not.toContain('Start typing...');

    editor.destroy();
  });

  it('should respect showOnlineStatus in awareness', async () => {
    const editor = new Editor('editor-container');

    const mockAwareness = {
      setLocalStateField: jest.fn(),
      on: jest.fn(),
      getStates: jest.fn().mockReturnValue(new Map()),
    };
    editor.provider = { awareness: mockAwareness };

    // Test Case 1: Status is OFF
    editor.updateUser({ username: 'ghost', showOnlineStatus: false });
    expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('user', null);

    // Test Case 2: Status is ON
    editor.updateUser({
      username: 'visible',
      showOnlineStatus: true,
      accentColor: '#ff0000',
    });
    expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({
        username: 'visible',
      })
    );
  });

  it('should not create a second provider for the same connecting document', async () => {
    const editor = new Editor('editor-container');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockProviderInstances).toHaveLength(1);
    await editor.connectWebSocket('test-doc', { username: 'TestUser' });

    expect(mockProviderInstances).toHaveLength(1);
    expect(mockProviderInstances[0].connect).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it('should schedule one guarded reconnect after unexpected close', async () => {
    const editor = new Editor('editor-container');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const provider = mockProviderInstances[0];
    expect(provider).toBeDefined();

    jest.useFakeTimers();
    try {
      provider.wsconnected = true;
      provider.wsconnecting = false;
      provider.shouldConnect = true;

      provider.emit(
        'connection-close',
        { type: 'close', code: 1006, reason: '', wasClean: false },
        provider
      );
      provider.emit(
        'connection-close',
        { type: 'close', code: 1006, reason: '', wasClean: false },
        provider
      );

      expect(provider.shouldConnect).toBe(false);
      expect(provider.connect).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1000);

      expect(provider.params.ticket).toBe('mock-ticket');
      expect(provider.connect).toHaveBeenCalledTimes(2);
      editor.destroy();
    } finally {
      jest.useRealTimers();
    }
  });
});
