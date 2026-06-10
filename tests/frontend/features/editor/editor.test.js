/**
 * @jest-environment jsdom
 */

import { Editor } from '/js/features/editor/editor.js';
import * as Y from 'yjs';
import { get } from 'idb-keyval';
import { Network } from '/js/app/network.js';

jest.mock('idb-keyval');
jest.mock('/js/app/network.js', () => ({
  Network: {
    fetchAPI: jest.fn(),
    getWebSocketBaseUrl: jest.fn().mockReturnValue('ws://localhost'),
  },
}));
jest.mock('y-websocket', () => ({
  WebsocketProvider: jest.fn().mockImplementation(() => ({
    awareness: {
      setLocalStateField: jest.fn(),
      on: jest.fn(),
      getStates: jest.fn().mockReturnValue(new Map()),
    },
    on: jest.fn(),
    destroy: jest.fn(),
  })),
}));
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
        Style: jest.fn().mockImplementation(() => ({})),
      },
      Scope: { INLINE: 'inline' },
    };
  }
  return { whitelist: [] };
});
global.Quill.register = jest.fn();
Element.prototype.scrollIntoView = jest.fn();

describe('Editor Lifecycle & Resilience', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '<div id="editor-container"></div><input id="docTitle">';

    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('test-doc'),
    }));

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ ticket: 'mock-ticket' }),
    });
    Network.fetchAPI.mockResolvedValue({ ticket: 'mock-ticket' });
  });

  it('should render from cache before WebSocket is connected', async () => {
    const mockDoc = new Y.Doc();
    const pages = mockDoc.getArray('pages');
    const pageMap = new Y.Map();
    pageMap.set('content', new Y.Text('Cached Content'));
    pages.push([pageMap]);
    const cachedUpdate = Y.encodeStateAsUpdate(mockDoc);

    get.mockResolvedValue(cachedUpdate);

    const editor = new Editor('editor-container', { docId: 'test-doc' });
    const didLoadCache = await editor.loadFromCache('test-doc');

    expect(didLoadCache).toBe(true);
    expect(get).toHaveBeenCalledWith('doc-store-test-doc');
    expect(editor.hasRenderableContent()).toBe(true);
  });

  it('should apply snapshot state without blocking on realtime', async () => {
    const snapshotDoc = new Y.Doc();
    const meta = snapshotDoc.getMap('meta');
    meta.set('title', 'Snapshot Title');
    const pages = snapshotDoc.getArray('pages');
    const page = new Y.Map();
    page.set('id', 'page-1');
    const content = new Y.Text();
    content.insert(0, 'Snapshot Body');
    page.set('content', content);
    pages.push([page]);

    const bytes = Y.encodeStateAsUpdate(snapshotDoc);
    const b64 = btoa(String.fromCharCode(...bytes));

    const editor = new Editor('editor-container', { docId: 'test-doc' });
    const applied = await editor.applySnapshot({
      title: 'Snapshot Title',
      yjsState: b64,
    });

    expect(applied).toBe(true);
    expect(editor.hasRenderableContent()).toBe(true);
  });

  it('should respect showOnlineStatus in awareness', async () => {
    const editor = new Editor('editor-container', { docId: 'test-doc' });
    const mockAwareness = {
      setLocalStateField: jest.fn(),
      on: jest.fn(),
      getStates: jest.fn().mockReturnValue(new Map()),
    };

    editor.provider = { awareness: mockAwareness };

    editor.updateUser({ username: 'ghost', showOnlineStatus: false });
    expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith('user', null);

    editor.updateUser({
      username: 'visible',
      showOnlineStatus: true,
      accentColor: '#ff0000',
    });
    expect(mockAwareness.setLocalStateField).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({ username: 'visible' })
    );
  });

  it('should destroy provider and listeners cleanly', () => {
    const editor = new Editor('editor-container', { docId: 'test-doc' });
    const removeListenerSpy = jest.spyOn(window, 'removeEventListener');

    editor.destroy();

    expect(editor.destroyed).toBe(true);
    expect(removeListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    removeListenerSpy.mockRestore();
  });
});
