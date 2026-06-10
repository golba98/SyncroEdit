import { Plugin } from '/js/app/Plugin.js';

export class SelectionManager extends Plugin {
  constructor(editor, options) {
    super(editor, options);
    this.isSelecting = false;
    this.startPoint = null; // { pageIndex, index }
    this.currentPoint = null; // { pageIndex, index }

    // Store overlay elements for cleanup
    this.overlays = [];
  }

  init() {
    this.setupGlobalListeners();
  }

  setupGlobalListeners() {
    // Global tracking
    this.addDisposableListener(document, 'mousemove', (e) => this.handleMouseMove(e));
    this.addDisposableListener(document, 'mouseup', () => this.handleMouseUp());

    // Intercept Copy/Cut
    this.addDisposableListener(document, 'copy', (e) => this.handleCopy(e));
    this.addDisposableListener(document, 'cut', (e) => this.handleCut(e));
  }

  handleMouseDown(pageIndex, range) {
    this.isSelecting = true;
    this.startPoint = { pageIndex, index: range.index };
    this.currentPoint = { pageIndex, index: range.index };
    this.clearOverlays();
  }

  handleMouseMove(e) {
    if (!this.isSelecting || !this.startPoint) return;

    // Which page is under mouse?
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;

    const editorContainer = target.closest('.editor-container');
    if (!editorContainer) return;

    const pageId = editorContainer.dataset.pageId;
    const pages = this.editor.yPages.toArray();
    const pageIndex = pages.findIndex((p) => p.get('id') === pageId);
    if (pageIndex === -1) return;

    const quill = this.editor.pageQuillInstances.get(pageId);
    if (!quill) return;

    // Use browser native selection to find index on this page?
    // Safer: Quill's getSelection might update automatically if we are dragging.
    const range = quill.getSelection();
    if (range) {
      this.currentPoint = { pageIndex, index: range.index + range.length };
      this.renderVisuals();
    } else {
      // Fallback: Estimate index based on Y coordinate relative to quill?
      // For now, assume Quill catches the drag if it's active.
    }
  }

  updateSelection(pageIndex, range) {
    if (!this.isSelecting) return;
    this.currentPoint = { pageIndex, index: range.index + range.length };
    this.renderVisuals();
  }

  handleMouseUp() {
    this.isSelecting = false;
  }

  clearOverlays() {
    this.overlays.forEach((el) => el.remove());
    this.overlays = [];
  }

  renderVisuals() {
    this.clearOverlays();

    if (!this.startPoint || !this.currentPoint) return;

    let start = this.startPoint;
    let end = this.currentPoint;

    // Normalize
    if (
      start.pageIndex > end.pageIndex ||
      (start.pageIndex === end.pageIndex && start.index > end.index)
    ) {
      [start, end] = [end, start];
    }

    if (start.pageIndex === end.pageIndex) return;

    const pagesArr = this.editor.yPages.toArray();

    for (let i = start.pageIndex; i <= end.pageIndex; i++) {
      const pageMap = pagesArr[i];
      if (!pageMap) continue;
      const pageId = pageMap.get('id');
      const quill = this.editor.pageQuillInstances.get(pageId);
      if (!quill) continue;

      // Don't draw overlay on the page that has the real browser selection
      if (quill.hasFocus()) continue;

      let pStart = 0;
      let pEnd = quill.getLength();

      if (i === start.pageIndex) pStart = start.index;
      if (i === end.pageIndex) pEnd = end.index;

      const length = Math.max(0, pEnd - pStart);
      if (length === 0) continue;

      this.createHighlight(pageId, quill, pStart, length);
    }
  }

  createHighlight(pageId, quill, index, length) {
    const container = document.getElementById(`page-container-${pageId}`);
    if (!container) return;

    const bounds = quill.getBounds(index, length);
    if (!bounds) return;

    const overlay = document.createElement('div');
    overlay.className = 'selection-bridge-overlay';
    overlay.style.position = 'absolute';
    overlay.style.left = `${bounds.left}px`;
    overlay.style.top = `${bounds.top}px`;
    overlay.style.width = `${bounds.width}px`;
    overlay.style.height = `${bounds.height}px`;
    overlay.style.backgroundColor = 'rgba(var(--accent-color-rgb), 0.3)';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '10';

    const editorDiv = container.querySelector('.page-editor');
    if (editorDiv) {
      editorDiv.appendChild(overlay);
      this.overlays.push(overlay);
    }
  }

  handleCopy(e) {
    if (!this.startPoint || !this.currentPoint) return;

    let start = this.startPoint;
    let end = this.currentPoint;
    if (
      start.pageIndex > end.pageIndex ||
      (start.pageIndex === end.pageIndex && start.index > end.index)
    ) {
      [start, end] = [end, start];
    }

    if (start.pageIndex === end.pageIndex) return;

    e.preventDefault();

    let fullText = '';
    const pagesArr = this.editor.yPages.toArray();

    for (let i = start.pageIndex; i <= end.pageIndex; i++) {
      const pageMap = pagesArr[i];
      if (!pageMap) continue;
      const quill = this.editor.pageQuillInstances.get(pageMap.get('id'));
      if (!quill) continue;

      let pStart = 0;
      let pEnd = quill.getLength();

      if (i === start.pageIndex) pStart = start.index;
      if (i === end.pageIndex) pEnd = end.index;

      const length = Math.max(0, pEnd - pStart);
      fullText += quill.getText(pStart, length);
    }

    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', fullText);
    }
  }

  handleCut(e) {
    if (!this.startPoint || !this.currentPoint) return;
    this.handleCopy(e);
    // Multi-page delete logic could be added here
  }
}
