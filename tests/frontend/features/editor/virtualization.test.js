/**
 * @jest-environment jsdom
 */

import { Editor } from '/js/features/editor/editor.js';
import * as Y from 'yjs';

jest.mock('idb-keyval', () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn(),
}));
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
      getStates: jest.fn(),
    },
    on: jest.fn(),
    destroy: jest.fn(),
  })),
}));
jest.mock('y-quill', () => ({
  QuillBinding: jest.fn().mockImplementation(() => ({ destroy: jest.fn() })),
}));

global.Quill = class {
  constructor() {
    this.root = document.createElement('div');
    this.on = jest.fn();
    this.getLength = jest.fn().mockReturnValue(1);
    this.getText = jest.fn().mockReturnValue('');
  }
  static import(path) {
    if (path === 'parchment') {
      return {
        Scope: { INLINE: 'inline' },
        Attributor: { Style: class {} },
      };
    }
    return { whitelist: [] };
  }
  static register() {}
};

describe('Editor Virtualization / Scalability', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="editor-container"></div><input id="docTitle">';
  });

  it('creates page containers only for pages missing in the DOM', () => {
    const editor = new Editor('editor-container', { docId: 'doc-1' });
    const createPageContainerSpy = jest.spyOn(editor, 'createPageContainer');

    const first = new Y.Map();
    first.set('id', 'page-1');
    first.set('content', new Y.Text());
    const second = new Y.Map();
    second.set('id', 'page-2');
    second.set('content', new Y.Text());

    editor.yPages.push([first, second]);
    editor.renderAllPages();

    expect(createPageContainerSpy).toHaveBeenCalledTimes(2);

    createPageContainerSpy.mockClear();
    editor.renderAllPages();

    expect(createPageContainerSpy).not.toHaveBeenCalled();
  });

  it('handles large page lists without mounting quill instances eagerly', () => {
    const editor = new Editor('editor-container', { docId: 'doc-1' });
    const mountPageSpy = jest.spyOn(editor, 'mountPage');

    for (let index = 0; index < 200; index++) {
      const page = new Y.Map();
      page.set('id', `page-${index}`);
      page.set('content', new Y.Text());
      editor.yPages.push([page]);
    }

    editor.renderAllPages();

    expect(editor.container.querySelectorAll('.editor-container').length).toBe(200);
    expect(mountPageSpy).not.toHaveBeenCalled();
  });
});
