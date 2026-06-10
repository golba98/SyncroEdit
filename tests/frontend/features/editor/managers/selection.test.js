/**
 * @jest-environment jsdom
 */

import { SelectionManager } from '../../../../../public/js/features/editor/managers/SelectionManager.js';

// Mock Editor
class MockEditor {
  constructor() {
    this.pageQuillInstances = new Map();
    this.yPages = {
      toArray: () => [
        { get: (key) => (key === 'id' ? '0' : null) },
        { get: (key) => (key === 'id' ? '1' : null) },
      ],
    };
  }
}

// Mock Quill
class MockQuill {
  constructor() {
    this.root = document.createElement('div');
    this.getLength = jest.fn().mockReturnValue(100);
    this.getBounds = jest.fn().mockReturnValue({ left: 0, top: 0, width: 100, height: 20 });
    this.getText = jest.fn().mockReturnValue('Mock Content');
    this.hasFocus = jest.fn().mockReturnValue(false);
  }
}

describe('SelectionManager', () => {
  let editor;
  let manager;

  beforeEach(() => {
    editor = new MockEditor();
    manager = new SelectionManager(editor);

    // Setup mock pages
    document.body.innerHTML = `
            <div class="editor-container" id="page-container-0" data-page-index="0">
                <div class="page-editor"></div>
            </div>
            <div class="editor-container" id="page-container-1" data-page-index="1">
                <div class="page-editor"></div>
            </div>
        `;

    editor.pageQuillInstances.set('0', new MockQuill());
    editor.pageQuillInstances.set('1', new MockQuill());
  });

  test('should initialize correctly', () => {
    expect(manager.isSelecting).toBe(false);
    expect(manager.overlays).toHaveLength(0);
  });

  test('should track start point on mousedown', () => {
    manager.handleMouseDown(0, { index: 10, length: 0 });
    expect(manager.isSelecting).toBe(true);
    expect(manager.startPoint).toEqual({ pageIndex: 0, index: 10 });
  });

  test('should update current point on selection change', () => {
    manager.handleMouseDown(0, { index: 10, length: 0 });
    manager.updateSelection(1, { index: 5, length: 0 });

    expect(manager.currentPoint).toEqual({ pageIndex: 1, index: 5 });
  });

  test('should render overlays for cross-page selection', () => {
    manager.handleMouseDown(0, { index: 90, length: 0 }); // Bottom of Page 0
    manager.updateSelection(1, { index: 10, length: 0 }); // Top of Page 1

    // Mock that Page 1 has focus (so no overlay there)
    editor.pageQuillInstances.get('1').hasFocus.mockReturnValue(true);
    // Page 0 does not have focus (needs overlay)
    editor.pageQuillInstances.get('0').hasFocus.mockReturnValue(false);

    manager.renderVisuals();

    // Expect 1 overlay (on Page 0)
    expect(manager.overlays).toHaveLength(1);

    // Verify overlay position
    const overlay = manager.overlays[0];
    expect(overlay.style.backgroundColor).toContain('rgba');
    expect(editor.pageQuillInstances.get('0').getBounds).toHaveBeenCalledWith(90, 10);
  });

  test('should handle copy event across pages', () => {
    manager.handleMouseDown(0, { index: 90, length: 0 });
    manager.updateSelection(1, { index: 10, length: 0 });

    const mockClipboard = {
      setData: jest.fn(),
    };

    const event = {
      preventDefault: jest.fn(),
      clipboardData: mockClipboard,
    };

    manager.handleCopy(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockClipboard.setData).toHaveBeenCalledWith('text/plain', 'Mock ContentMock Content');
  });
});
