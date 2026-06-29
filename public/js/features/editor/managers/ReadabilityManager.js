import { Plugin } from '/js/app/Plugin.js';

export class ReadabilityManager extends Plugin {
  constructor(editor, options) {
    super(editor, options);
    this.showLineNumbers = false;
    this.showInvisibles = false;
    this.showPageGlow = localStorage.getItem('synchroEditPageGlow') === 'true';
    this.showPageBorder = localStorage.getItem('synchroEditPageBorder') === 'true';
    this.currentCanvasTheme = localStorage.getItem('synchroEditCanvasTheme') || 'classic';
    this.isFocusMode = false;
  }

  init() {
    this.setupEventListeners();
    this.applyPageGlow();
    this.applyPageBorder();
  }

  setupEventListeners() {
    const addEvent = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) this.addDisposableListener(el, event, handler);
      const elements = document.querySelectorAll('.' + id);
      elements.forEach((element) => this.addDisposableListener(element, event, handler));
    };

    addEvent('canvasThemeSelect', 'change', (e) => this.setCanvasTheme(e.target.value));
    addEvent('toggleLineNumbers', 'click', () => this.toggleLineNumbers());
    addEvent('toggleInvisibles', 'click', () => this.toggleInvisibles());
    addEvent('enterFocusMode', 'click', () => this.setFocusMode(true));
    addEvent('exitFocusMode', 'click', () => this.setFocusMode(false));

    // Page Glow
    const glowToggle = document.getElementById('togglePageGlow');
    if (glowToggle) {
      glowToggle.checked = this.showPageGlow;
      this.addDisposableListener(glowToggle, 'change', (e) => {
        this.showPageGlow = e.target.checked;
        localStorage.setItem('synchroEditPageGlow', this.showPageGlow);
        this.applyPageGlow();
      });
    }

    // Page Border
    const borderToggle = document.getElementById('togglePageBorder');
    if (borderToggle) {
      borderToggle.checked = this.showPageBorder;
      this.addDisposableListener(borderToggle, 'change', (e) => {
        this.showPageBorder = e.target.checked;
        localStorage.setItem('synchroEditPageBorder', this.showPageBorder);
        this.applyPageBorder();
      });
    }

    // Zoom
    addEvent('zoomInBtn', 'click', () => this.updateZoom(10));
    addEvent('zoomOutBtn', 'click', () => this.updateZoom(-10));
    addEvent('zoomPercent', 'click', () => {
      this.editor.currentZoom = 100;
      this.editor.applyZoom();
      this.updateZoomDisplay();
    });
    addEvent('zoom100', 'click', () => {
      this.editor.currentZoom = 100;
      this.editor.applyZoom();
      this.updateZoomDisplay();
    });
  }

  updateZoom(delta) {
    const newZoom = this.editor.currentZoom + delta;
    if (newZoom >= 50 && newZoom <= 200) {
      this.editor.currentZoom = newZoom;
      this.editor.applyZoom();
      this.updateZoomDisplay();
    }
  }

  updateZoomDisplay() {
    const el = document.getElementById('zoomPercent');
    if (el) el.textContent = `${this.editor.currentZoom}%`;
    const elements = document.querySelectorAll('.zoomPercent');
    elements.forEach((element) => (element.textContent = `${this.editor.currentZoom}%`));
  }

  setCanvasTheme(theme) {
    this.currentCanvasTheme = theme;
    const containers = document.querySelectorAll('.editor-container');
    containers.forEach((container) => {
      // Remove all canvas theme classes
      container.classList.remove(
        'canvas-classic',
        'canvas-sepia',
        'canvas-midnight',
        'canvas-math'
      );
      // Add new one
      container.classList.add(`canvas-${theme}`);
    });
    localStorage.setItem('synchroEditCanvasTheme', theme);
  }

  toggleInvisibles() {
    this.showInvisibles = !this.showInvisibles;
    const containers = document.querySelectorAll('.editor-container');
    containers.forEach((container) => {
      container.classList.toggle('show-invisibles', this.showInvisibles);
    });

    const btn = document.getElementById('toggleInvisibles');
    if (btn) btn.classList.toggle('active', this.showInvisibles);
  }

  toggleLineNumbers() {
    this.showLineNumbers = !this.showLineNumbers;
    this.updateAllGutters();

    const btn = document.getElementById('toggleLineNumbers');
    if (btn) btn.classList.toggle('active', this.showLineNumbers);
  }

  updateAllGutters() {
    const pages = this.editor.yPages.toArray();
    pages.forEach((_, index) => {
      this.updateGutter(index);
    });
  }

  updateGutter(pageIndex) {
    const pageMap = this.editor.yPages.get(pageIndex);
    if (!pageMap) return;
    const pageId = pageMap.get('id');

    const container = document.getElementById(`page-container-${pageId}`);
    if (!container) return;

    let gutter = container.querySelector('.line-numbers-gutter');

    if (!this.showLineNumbers) {
      if (gutter) gutter.style.display = 'none';
      return;
    }

    if (!gutter) {
      gutter = document.createElement('div');
      gutter.className = 'line-numbers-gutter';
      container.insertBefore(gutter, container.firstChild);
    }

    gutter.style.display = 'block';

    const quill = this.editor.pageQuillInstances.get(pageId);
    if (!quill) return;

    const lines = quill.getLines();
    const lineNumberElements = lines.map((_, i) => {
      const lineNumber = document.createElement('div');
      lineNumber.textContent = String(i + 1);
      return lineNumber;
    });
    gutter.replaceChildren(...lineNumberElements);
  }

  applyPageGlow() {
    document.body.classList.toggle('glow-enabled', this.showPageGlow);
    const containers = document.querySelectorAll('.editor-container');
    containers.forEach((container) => {
      container.classList.toggle('glow-effect', this.showPageGlow);
    });
  }

  applyPageBorder() {
    const containers = document.querySelectorAll('.editor-container');
    containers.forEach((container) => {
      container.classList.toggle('border-enabled', this.showPageBorder);
    });
  }

  setFocusMode(active) {
    this.isFocusMode = active;
    document.body.classList.toggle('focus-mode', active);
  }

  // Called when a new page is created
  onPageCreated(pageIndex, container) {
    if (this.currentCanvasTheme !== 'classic') {
      container.classList.add(`canvas-${this.currentCanvasTheme}`);
    }
    if (this.showInvisibles) {
      container.classList.add('show-invisibles');
    }
    if (this.showPageGlow) {
      container.classList.add('glow-effect');
    }
    if (this.showPageBorder) {
      container.classList.add('border-enabled');
    }
    if (this.showLineNumbers) {
      this.updateGutter(pageIndex);
    }
  }
}
