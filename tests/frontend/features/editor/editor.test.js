/**
 * @jest-environment jsdom
 */

import { Editor } from '/js/features/editor/editor.js';
import * as Y from 'yjs';
import { get, set } from 'idb-keyval';
import { QuillBinding } from 'y-quill';

// Mocks
jest.mock('idb-keyval');
jest.mock('y-websocket', () => {
  return {
    WebsocketProvider: jest.fn().mockImplementation(() => ({
      awareness: {
        setLocalStateField: jest.fn(),
        on: jest.fn(),
        getStates: jest.fn().mockReturnValue(new Map()),
      },
      on: jest.fn(),
      destroy: jest.fn(),
    })),
  };
});
jest.mock('y-quill', () => ({
  QuillBinding: jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
  })),
}));

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

describe('Editor Lifecycle & Resilience', () => {
  let container;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="editor-container"></div><input id="docTitle">';
    container = document.getElementById('editor-container');

    // Mock URL search params
    global.URLSearchParams = jest.fn((search) => ({
      get: jest.fn().mockReturnValue('test-doc'),
    }));

    // Mock fetch for WS ticket
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: jest.fn().mockResolvedValue({ ticket: 'mock-ticket' }),
    });
  });

  it('should render from cache before WebSocket is connected', async () => {
    const mockDoc = new Y.Doc();
    const pages = mockDoc.getArray('pages');
    const pageMap = new Y.Map();
    pageMap.set('content', new Y.Text('Cached Content'));
    pages.push([pageMap]);
    const cachedUpdate = Y.encodeStateAsUpdate(mockDoc);

    get.mockResolvedValue(cachedUpdate);

    const editor = new Editor('editor-container');

    // Wait for loadFromCache
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(get).toHaveBeenCalledWith('doc-store-test-doc');
    const pageEditors = document.querySelectorAll('.page-editor');
    expect(pageEditors.length).toBeGreaterThan(0);
  });

  it('should not throw error if provider is not ready during page creation', async () => {
    const editor = new Editor('editor-container');
    editor.provider = null; // Simulate provider not ready yet

    const mockDoc = new Y.Doc();
    const pageMap = mockDoc.getMap('page1');
    pageMap.set('content', new Y.Text('Test'));

    // This should NOT throw "Cannot read properties of null (reading 'awareness')"
    // because of our fix in editor.js
    expect(() => {
      editor.createPageEditor(0, pageMap);
    }).not.toThrow();

    expect(QuillBinding).not.toHaveBeenCalled();
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
    editor.updateUser({ username: 'visible', showOnlineStatus: true, accentColor: '#ff0000' });
    expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({
        username: 'visible',
      })
    );
  });
});
