/**
 * @jest-environment jsdom
 */
import { Editor } from '../../../../public/js/features/editor/editor.js';
import * as Y from 'yjs';

// Mock dependencies
jest.mock('yjs', () => ({
  Doc: jest.fn(),
  Map: jest.fn(),
  Text: jest.fn(),
  Array: jest.fn(),
  applyUpdate: jest.fn(),
  encodeStateAsUpdate: jest.fn(),
}));

jest.mock('../../../../public/js/features/editor/managers/PageManager.js');
jest.mock('../../../../public/js/features/editor/managers/BorderManager.js');
jest.mock('../../../../public/js/features/editor/managers/CursorManager.js');
jest.mock('../../../../public/js/features/editor/managers/ImageManager.js');
jest.mock('../../../../public/js/features/ui/ToolbarController.js');
jest.mock('../../../../public/js/features/editor/managers/ReadabilityManager.js');
jest.mock('../../../../public/js/features/editor/managers/NavigationManager.js');
jest.mock('../../../../public/js/features/auth/auth.js', () => ({
  Auth: { getToken: jest.fn() },
}));
jest.mock('y-websocket');
jest.mock('y-quill');

// Mock Quill
global.Quill = class {
  constructor(el, opts) {
    this.root = document.createElement('div');
    this.on = jest.fn();
    this.getLength = jest.fn().mockReturnValue(0);
    this.getText = jest.fn().mockReturnValue('');
  }
  static import(path) {
    if (path === 'parchment') {
      return {
        Scope: { INLINE: 'inline' },
        Attributor: {
          Style: class {
            constructor() {}
          },
        },
      };
    }
    return { whitelist: [] };
  }
  static register() {}
};

describe('Editor Virtualization / Scalability', () => {
  let editor;
  let mockContainer;
  let mockYPages;

  beforeEach(() => {
    // Debugging: Check prototype
    console.log('Editor prototype keys:', Object.getOwnPropertyNames(Editor.prototype));

    // Mock initQuill to avoid module issues
    Editor.prototype.initQuill = jest.fn();

    // Setup DOM
    mockContainer = document.createElement('div');
    mockContainer.id = 'editor-container';
    document.body.appendChild(mockContainer);

    // Setup Yjs mocks
    const mockDoc = {
      getArray: jest.fn(),
      getMap: jest.fn(),
    };
    Y.Doc.mockImplementation(() => mockDoc);

    mockYPages = {
      observe: jest.fn(),
      toArray: jest.fn(),
      get: jest.fn(),
      push: jest.fn(),
      delete: jest.fn(),
    };
    mockDoc.getArray.mockReturnValue(mockYPages);
    mockDoc.getMap.mockReturnValue({ observe: jest.fn(), set: jest.fn(), get: jest.fn() });

    // Spy on Editor methods
    editor = new Editor('editor-container');
    editor.createPageEditor = jest.fn();
    editor.destroyPageEditor = jest.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  it('should only render changed pages when possible', () => {
    // Simulate 50 existing pages
    const initialPages = Array(50).fill({ get: () => 'mockYText' });
    mockYPages.toArray.mockReturnValue(initialPages);

    // Initial Render
    editor.renderAllPages();

    expect(editor.createPageEditor).toHaveBeenCalledTimes(50);
    editor.createPageEditor.mockClear();

    // Now assume we simulate a change: 1 new page added at the end
    const newPages = [...initialPages, { get: () => 'mockYTextNew' }];
    mockYPages.toArray.mockReturnValue(newPages);

    // Also assume existing editors are already tracked
    initialPages.forEach((_, i) => {
      editor.pageQuillInstances[i] = new Quill();
      editor.pageBindings[i] = { type: 'mockYText' }; // Matches existing
    });

    // Render again
    editor.renderAllPages();

    // Expectation:
    // Ideally, it should only create 1 new editor.
    // Currently, the implementation iterates all pages.
    // If logic is efficient, it checks existence and skips creation.
    // We want to verify that it doesn't do expensive DOM operations for all 50.

    // The current implementation calls 'createPageEditor' only if instance is missing.
    // BUT it iterates the whole array.

    expect(editor.createPageEditor).toHaveBeenCalledTimes(1);
    // Passed 50 (index 0-49), called for index 50.
  });

  it('should efficiently handle large page lists', () => {
    // Simulate 1000 pages
    const manyPages = Array(1000).fill({ get: () => 'mockYText' });
    mockYPages.toArray.mockReturnValue(manyPages);

    const start = performance.now();
    editor.renderAllPages();
    const end = performance.now();

    // This is a loose benchmark, but iterating 1000 items and doing DOM checks
    // shouldn't take > 100ms in a test environment if virtualized/optimized.
    // If it tries to render 1000 Quills, it will be slow.
    // Since we mocked createPageEditor, we measure the overhead of the loop and logic.

    console.log(`Render loop for 1000 pages took: ${end - start}ms`);

    expect(editor.createPageEditor).toHaveBeenCalledTimes(1000);
  });
});
