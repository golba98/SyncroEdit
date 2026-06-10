import { Plugin } from '/js/app/Plugin.js';

export class CursorManager extends Plugin {
  constructor(editor, options) {
    super(editor, options);
    this.currentRange = null;
  }

  // init() is empty here because setupPageListeners is called externally by Editor.js when pages are mounted.
  // However, I should check if there are global listeners to add.
  // The current CursorManager doesn't seem to have global listeners in constructor.

  setupPageListeners(pageQuill, pageId) {
    // Selection Change
    pageQuill.on('selection-change', (range) => {
      if (range) {
        this.currentRange = range;
        const pages = this.editor.yPages.toArray();
        const pageIndex = pages.findIndex((p) => p.get('id') === pageId);

        if (pageIndex !== -1) {
          // Notify SelectionManager
          if (this.editor.selectionManager) {
            this.editor.selectionManager.updateSelection(pageIndex, range);
          }

          if (pageIndex !== this.editor.currentPageIndex) {
            this.editor.quill = pageQuill;
            this.editor.currentPageIndex = pageIndex;
            this.editor.onPageChange(pageIndex);
          }
        }
      }
    });

    // Mouse Down - Start Selection
    // Since these are per-page listeners attached to Quill instances created dynamically,
    // they are not "global" plugin listeners. They are lifecycle managed by mountPage/unmountPage in Editor.js.
    // However, ideally, plugins should hook into "page:mount" events instead of Editor calling them directly.
    // For this refactor step, I will keep the method public so Editor can call it, but in a "Perfect" plugin system,
    // Editor would emit 'page-mounted' and this plugin would listen to it.

    // For now, adhering to the plan:
    pageQuill.root.addEventListener('mousedown', () => {
      const pages = this.editor.yPages.toArray();
      const pageIndex = pages.findIndex((p) => p.get('id') === pageId);
      const range = pageQuill.getSelection();
      if (range && this.editor.selectionManager) {
        this.editor.selectionManager.handleMouseDown(pageIndex, range);
      }
    });
  }

  getSelection() {
    if (this.editor.quill) {
      return this.editor.quill.getSelection();
    }
    return null;
  }

  setSelection(index, length = 0, source = 'api') {
    if (this.editor.quill) {
      this.editor.quill.setSelection(index, length, source);
    }
  }

  focus() {
    if (this.editor.quill) {
      this.editor.quill.focus();
    }
  }

  scrollToCursor(pageIndex, behavior = 'smooth', cursorIndex = null) {
    const pageMap = this.editor.yPages.get(pageIndex);
    if (!pageMap) return;
    const pageId = pageMap.get('id');
    const container = document.getElementById(`page-container-${pageId}`);
    const scrollParent = document.getElementById('pagesContainer');
    const quill = this.editor.pageQuillInstances.get(pageId);

    if (container && scrollParent && quill) {
      const parentRect = scrollParent.getBoundingClientRect();
      const pageRect = container.getBoundingClientRect();

      let targetY = pageRect.top - parentRect.top + scrollParent.scrollTop;

      if (cursorIndex !== null) {
        const bounds = quill.getBounds(cursorIndex);
        if (bounds) {
          const scale = (this.editor.currentZoom || 100) / 100;
          // Add the relative cursor Y to the page top, adjusted for scale and padding
          targetY += bounds.top * scale;

          // Center the cursor in the viewport for better context
          const viewportHeight = parentRect.height;
          targetY -= viewportHeight / 2;
        }
      }

      scrollParent.scrollTo({
        top: Math.max(0, targetY),
        behavior: behavior,
      });
    }
  }
}
