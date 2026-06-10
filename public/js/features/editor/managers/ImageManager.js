import { Plugin } from '/js/app/Plugin.js';

export class ImageManager extends Plugin {
  constructor(editor, options) {
    super(editor, options);
    this.overlay = null;
    this.currentImage = null;
    this.resizeStart = { x: 0, y: 0, w: 0, h: 0 };
    this.isResizing = false;
  }

  init() {
    this.setupOverlay();

    // Listen for image clicks on the document
    this.addDisposableListener(document, 'click', (e) => this.handleImageClick(e));

    // Listen for scroll/resize to update overlay
    this.addDisposableListener(window, 'scroll', () => this.updateOverlayPosition());
    this.addDisposableListener(window, 'resize', () => this.updateOverlayPosition());

    this.setupDragAndDrop();
  }

  setupDragAndDrop() {
    const container = document.getElementById('pagesContainer');
    if (!container) return;

    // Support moving existing images between pages
    this.addDisposableListener(container, 'dragstart', (e) => {
      if (e.target.tagName === 'IMG') {
        const blot = Quill.find(e.target);
        if (blot) {
          const quill = Quill.find(e.target.closest('.ql-container'));
          const index = quill.getIndex(blot);
          const delta = quill.getContents(index, 1);

          // Store image data and its origin
          const imageData = {
            delta: delta,
            originPageId: e.target.closest('.editor-container').dataset.pageId,
            originIndex: index,
          };
          e.dataTransfer.setData('application/syncroedit-image', JSON.stringify(imageData));
          e.dataTransfer.effectAllowed = 'move';
        }
      }
    });

    this.addDisposableListener(container, 'dragover', (e) => {
      e.preventDefault();
      container.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    });

    this.addDisposableListener(container, 'dragleave', () => {
      container.classList.remove('drag-over');
    });

    this.addDisposableListener(container, 'drop', (e) => {
      e.preventDefault();
      container.classList.remove('drag-over');

      // 1. Handle Internal Move
      const internalData = e.dataTransfer.getData('application/syncroedit-image');
      if (internalData) {
        const data = JSON.parse(internalData);
        this.handleInternalImageMove(e, data);
        return;
      }

      // 2. Handle External File Drop
      const files = e.dataTransfer.files;
      if (files && files[0] && files[0].type.startsWith('image/')) {
        this.handleFileUpload(files[0], e);
      }
    });
  }

  handleInternalImageMove(e, data) {
    // Find target Quill instance based on drop coordinates
    const targetElement = document.elementFromPoint(e.clientX, e.clientY);
    const targetEditorContainer = targetElement.closest('.editor-container');
    if (!targetEditorContainer) return;

    const targetPageId = targetEditorContainer.dataset.pageId;
    const targetQuill = this.editor.pageQuillInstances.get(targetPageId);
    if (!targetQuill) return;

    this.editor.doc.transact(() => {
      // 1. Remove from origin
      const originQuill = this.editor.pageQuillInstances.get(data.originPageId);
      if (originQuill) {
        originQuill.deleteText(data.originIndex, 1, 'user');
      }

      // 2. Insert at target
      targetQuill.updateContents(data.delta, 'user');
    });

    // Reflow both pages
    this.editor.pageManager.performReflowCheck();
  }

  handleFileUpload(file, e = null) {
    let targetQuill = this.editor.quill;

    // If dropped, find exactly where it was dropped
    if (e && e.clientX) {
      const targetElement = document.elementFromPoint(e.clientX, e.clientY);
      const targetEditorContainer = targetElement
        ? targetElement.closest('.editor-container')
        : null;
      if (targetEditorContainer) {
        const pageId = targetEditorContainer.dataset.pageId;
        targetQuill = this.editor.pageQuillInstances.get(pageId);
      }
    }

    if (!targetQuill) {
      console.warn('[ImageManager] No target Quill instance found for upload');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const range = targetQuill.getSelection(true);
      const index = range ? range.index : targetQuill.getLength() - 1;

      // Insert the image
      targetQuill.insertEmbed(index, 'image', event.target.result, 'user');

      // Ensure reflow happens after insertion
      // For data URLs, the image is often already "loaded" by the time we attach the listener
      requestAnimationFrame(() => {
        this.editor.pageManager.performReflowCheck();

        // Secondary check once the browser has definitely rendered the image
        const images = targetQuill.root.querySelectorAll('img');
        const lastImg = images[images.length - 1];
        if (lastImg && !lastImg.complete) {
          lastImg.onload = () => this.editor.pageManager.performReflowCheck();
        }
      });
    };
    reader.readAsDataURL(file);
  }

  setupOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'image-resizer-overlay';
    this.overlay.style.display = 'none';
    this.overlay.style.position = 'absolute';
    this.overlay.style.border = '2px solid var(--accent-color)';
    this.overlay.style.pointerEvents = 'none'; // Allow clicks to pass through except handles
    this.overlay.style.zIndex = '100';

    // Handles
    const createHandle = (cursor, pos) => {
      const h = document.createElement('div');
      h.style.width = '12px';
      h.style.height = '12px';
      h.style.background = 'var(--accent-color)';
      h.style.border = '1px solid white';
      h.style.position = 'absolute';
      h.style.cursor = cursor;
      h.style.pointerEvents = 'auto';
      h.dataset.pos = pos;
      this.addDisposableListener(h, 'mousedown', (e) => this.startResize(e, pos));
      return h;
    };

    this.handles = {
      se: createHandle('nwse-resize', 'se'),
      sw: createHandle('nesw-resize', 'sw'),
      ne: createHandle('nesw-resize', 'ne'),
      nw: createHandle('nwse-resize', 'nw'),
    };

    Object.values(this.handles).forEach((h) => this.overlay.appendChild(h));

    // Toolbar for float
    this.toolbar = document.createElement('div');
    this.toolbar.style.position = 'absolute';
    this.toolbar.style.top = '-40px';
    this.toolbar.style.left = '50%';
    this.toolbar.style.transform = 'translateX(-50%)';
    this.toolbar.style.background = '#1a1a1a';
    this.toolbar.style.border = '1px solid #333';
    this.toolbar.style.padding = '4px';
    this.toolbar.style.borderRadius = '4px';
    this.toolbar.style.display = 'flex';
    this.toolbar.style.gap = '4px';
    this.toolbar.style.pointerEvents = 'auto';

    const createBtn = (icon, action, title) => {
      const btn = document.createElement('button');
      btn.innerHTML = `<i class="fas ${icon}"></i>`;
      btn.title = title;
      btn.style.background = 'transparent';
      btn.style.border = 'none';
      btn.style.color = '#e0e0e0';
      btn.style.cursor = 'pointer';
      btn.style.padding = '4px 8px';
      this.addDisposableListener(btn, 'click', (e) => {
        e.stopPropagation();
        action();
      });
      this.addDisposableListener(
        btn,
        'mouseenter',
        () => (btn.style.color = 'var(--accent-color)')
      );
      this.addDisposableListener(btn, 'mouseleave', () => (btn.style.color = '#e0e0e0'));
      return btn;
    };

    this.toolbar.appendChild(
      createBtn('fa-align-left', () => this.setFloat('left'), 'Float Left (Wrap)')
    );
    this.toolbar.appendChild(createBtn('fa-align-justify', () => this.setFloat('none'), 'Inline'));
    this.toolbar.appendChild(
      createBtn('fa-align-right', () => this.setFloat('right'), 'Float Right (Wrap)')
    );

    this.overlay.appendChild(this.toolbar);
    document.body.appendChild(this.overlay);

    // Global mouse events for resizing
    this.addDisposableListener(document, 'mousemove', (e) => this.handleResize(e));
    this.addDisposableListener(document, 'mouseup', () => this.stopResize());
  }

  handleImageClick(e) {
    if (e.target.tagName === 'IMG' && e.target.closest('.ql-editor')) {
      this.selectImage(e.target);
    } else if (!e.target.closest('.image-resizer-overlay')) {
      this.deselectImage();
    }
  }

  selectImage(img) {
    this.currentImage = img;
    this.updateOverlayPosition();
    this.overlay.style.display = 'block';
  }

  deselectImage() {
    this.currentImage = null;
    this.overlay.style.display = 'none';
  }

  updateOverlayPosition() {
    if (!this.currentImage) return;

    const rect = this.currentImage.getBoundingClientRect();
    const scrollTop = window.scrollY;
    const scrollLeft = window.scrollX;

    this.overlay.style.top = `${rect.top + scrollTop}px`;
    this.overlay.style.left = `${rect.left + scrollLeft}px`;
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;

    // Position handles
    const offset = -6;

    this.handles.nw.style.top = `${offset}px`;
    this.handles.nw.style.left = `${offset}px`;

    this.handles.ne.style.top = `${offset}px`;
    this.handles.ne.style.right = `${offset}px`;

    this.handles.sw.style.bottom = `${offset}px`;
    this.handles.sw.style.left = `${offset}px`;

    this.handles.se.style.bottom = `${offset}px`;
    this.handles.se.style.right = `${offset}px`;
  }

  startResize(e, pos) {
    if (!this.currentImage) return;
    e.preventDefault();
    e.stopPropagation();

    this.isResizing = true;
    this.resizeStart = {
      x: e.clientX,
      y: e.clientY,
      w: this.currentImage.offsetWidth,
      h: this.currentImage.offsetHeight,
      pos,
    };
  }

  handleResize(e) {
    if (!this.isResizing || !this.currentImage) return;

    const dx = e.clientX - this.resizeStart.x;
    const dy = e.clientY - this.resizeStart.y;

    let newW = this.resizeStart.w;
    let newH = this.resizeStart.h;

    // Simple aspect ratio locking could be added here
    if (this.resizeStart.pos.includes('e')) newW += dx;
    if (this.resizeStart.pos.includes('w')) newW -= dx; // Logic for left resize is complex due to position
    if (this.resizeStart.pos.includes('s')) newH += dy;

    // Apply to image
    // We update style directly for smooth preview, but should ideally use Quill format on mouseup
    this.currentImage.style.width = `${newW}px`;
    this.currentImage.style.height = `${newH}px`;

    this.updateOverlayPosition();
  }

  stopResize() {
    if (this.isResizing && this.currentImage) {
      this.isResizing = false;

      // Sync with Quill
      // Find the Blot
      if (this.editor.quill) {
        const blot = Quill.find(this.currentImage);
        if (blot) {
          const index = this.editor.quill.getIndex(blot);
          this.editor.quill.formatText(
            index,
            1,
            {
              width: `${this.currentImage.offsetWidth}px`,
              height: `${this.currentImage.offsetHeight}px`,
            },
            'user'
          );
        }
      }
    }
  }

  setFloat(val) {
    if (!this.currentImage || !this.editor.quill) return;

    const blot = Quill.find(this.currentImage);
    if (blot) {
      const index = this.editor.quill.getIndex(blot);

      // Apply float
      this.editor.quill.formatText(index, 1, 'float', val, 'user');

      // If floating, we usually want display block or inline-block?
      // Quill image is inline-block by default.
      // Also add margin for spacing
      if (val !== 'none') {
        this.editor.quill.formatText(index, 1, 'margin', '10px', 'user');
      } else {
        this.editor.quill.formatText(index, 1, 'margin', false, 'user');
      }

      // Force update overlay
      setTimeout(() => this.updateOverlayPosition(), 100);
    }
  }
}
