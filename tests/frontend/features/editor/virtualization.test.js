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
  constructor() {
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
    jest.spyOn(editor, 'createPageContainer');
    editor.removePageById = jest.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  it('should only render changed pages when possible', () => {
    // Simulate 50 existing pages
    const initialPages = Array.from({ length: 50 }, (_, i) => ({
      get: (key) => (key === 'id' ? `page-${i}` : 'mockYText'),
    }));
    mockYPages.toArray.mockReturnValue(initialPages);

    // Initial Render
    editor.renderAllPages();

    expect(editor.createPageContainer).toHaveBeenCalledTimes(50);
    editor.createPageContainer.mockClear();

    // Now assume we simulate a change: 1 new page added at the end
    const newPages = [
      ...initialPages,
      { get: (key) => (key === 'id' ? 'page-50' : 'mockYTextNew') },
    ];
    mockYPages.toArray.mockReturnValue(newPages);

    // Also assume existing editors are already tracked
    initialPages.forEach((_, i) => {
      editor.pageQuillInstances.set(`page-${i}`, new Quill());
      editor.pageBindings.set(`page-${i}`, { type: 'mockYText' }); // Matches existing
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

    expect(editor.createPageContainer).toHaveBeenCalledTimes(1);
    // Passed 50 (index 0-49), called for index 50.
  });

  it('should efficiently handle large page lists', () => {
    // Simulate 1000 pages
    const manyPages = Array.from({ length: 1000 }, (_, i) => ({
      get: (key) => (key === 'id' ? `page-${i}` : 'mockYText'),
    }));
    mockYPages.toArray.mockReturnValue(manyPages);

    editor.renderAllPages();

    expect(editor.createPageContainer).toHaveBeenCalledTimes(1000);
  });
});
