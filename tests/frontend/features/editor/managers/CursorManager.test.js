/**
 * @jest-environment jsdom
 */

import { CursorManager } from '/js/features/editor/managers/CursorManager.js';

describe('CursorManager', () => {
  let editorMock;
  let cursorManager;
  let quillMock;

  beforeEach(() => {
    // Basic editor mock
    editorMock = {
      currentPageIndex: 0,
      quill: null, // Initially null
      onPageChange: jest.fn(),
      yPages: {
        toArray: jest
          .fn()
          .mockReturnValue([
            { get: (key) => (key === 'id' ? 0 : null) },
            { get: (key) => (key === 'id' ? 1 : null) },
            { get: (key) => (key === 'id' ? 2 : null) },
          ]),
        get: jest.fn().mockImplementation((idx) => ({ get: (key) => (key === 'id' ? idx : null) })),
      },
      pageQuillInstances: new Map([
        [0, quillMock],
        [1, quillMock],
        [2, quillMock],
      ]),
    };

    cursorManager = new CursorManager(editorMock);

    // Mock Quill instance
    quillMock = {
      on: jest.fn(),
      getSelection: jest.fn(),
      setSelection: jest.fn(),
      focus: jest.fn(),
      root: document.createElement('div'),
    };
  });

  describe('setupPageListeners', () => {
    it('should update editor state on selection change', () => {
      // Setup listener on page 1
      cursorManager.setupPageListeners(quillMock, 1);

      // Verify listener attached
      expect(quillMock.on).toHaveBeenCalledWith('selection-change', expect.any(Function));

      // Get the callback
      const callback = quillMock.on.mock.calls[0][1];

      // Simulate selection change
      const range = { index: 5, length: 0 };
      callback(range);

      // Verify updates
      expect(cursorManager.currentRange).toBe(range);
      expect(editorMock.currentPageIndex).toBe(1);
      expect(editorMock.quill).toBe(quillMock);
      expect(editorMock.onPageChange).toHaveBeenCalledWith(1);
    });

    it('should ignore null ranges', () => {
      cursorManager.setupPageListeners(quillMock, 1);
      const callback = quillMock.on.mock.calls[0][1];
      callback(null);

      expect(editorMock.onPageChange).not.toHaveBeenCalled();
    });
  });

  describe('Delegated Methods', () => {
    beforeEach(() => {
      editorMock.quill = quillMock;
    });

    it('should delegate getSelection to active quill', () => {
      quillMock.getSelection.mockReturnValue('mock-selection');
      expect(cursorManager.getSelection()).toBe('mock-selection');
    });

    it('should delegate setSelection to active quill', () => {
      cursorManager.setSelection(10, 5);
      expect(quillMock.setSelection).toHaveBeenCalledWith(10, 5, 'api');
    });

    it('should delegate focus to active quill', () => {
      cursorManager.focus();
      expect(quillMock.focus).toHaveBeenCalled();
    });
  });

  describe('scrollToCursor', () => {
    it('should scroll page container into view', () => {
      const mockElement = {
        scrollIntoView: jest.fn(),
        getBoundingClientRect: jest
          .fn()
          .mockReturnValue({ top: 100, bottom: 200, left: 0, right: 0, height: 100 }),
        scrollTo: jest.fn(),
      };
      document.getElementById = jest.fn().mockReturnValue(mockElement);

      cursorManager.scrollToCursor(2);

      expect(document.getElementById).toHaveBeenCalledWith('page-container-2');
      expect(mockElement.scrollTo).toHaveBeenCalledWith({
        top: expect.any(Number),
        behavior: 'smooth',
      });
    });
  });
});
