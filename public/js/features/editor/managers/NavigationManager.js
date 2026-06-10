import { Plugin } from '/js/app/Plugin.js';

export class NavigationManager extends Plugin {
  constructor(editor, options) {
    super(editor, options);
    this.outlineContainer = document.getElementById('outlineContainer');
    this.minimapContainer = document.getElementById('minimap');
    this.isOutlineVisible = false;
    this.isMinimapVisible = false;
    this.collapsedSections = new Set(); // Stores heading node IDs or indices
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    const addEvent = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) this.addDisposableListener(el, event, handler);
    };

    addEvent('toggleOutline', 'click', () => this.toggleOutline());
    addEvent('toggleMinimap', 'click', () => this.toggleMinimap());
    addEvent('closeOutline', 'click', () => this.toggleOutline());
    addEvent('closeMinimap', 'click', () => this.toggleMinimap());

    // Listen for editor changes to update navigation
    // Note: observeDeep doesn't return a cleanup function, so we can't easily dispose it via addDisposableListener.
    // Ideally, we'd wrap this or manually clean it up in destroy().
    // For now, we'll keep it as is, but mark it for future improvement.
    this.editor.doc.getArray('pages').observeDeep(() => {
      this.debounceUpdate();
    });

    // Intelligent Selection
    this.addDisposableListener(document, 'mousedown', (e) => this.handleTripleClick(e));
  }

  debounceUpdate() {
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    this.updateTimeout = setTimeout(() => {
      this.updateOutline();
      this.updateMinimap();
    }, 1000);
  }

  toggleOutline() {
    this.isOutlineVisible = !this.isOutlineVisible;
    const sidebar = document.getElementById('outlineSidebar');
    if (sidebar) {
      sidebar.style.display = this.isOutlineVisible ? 'flex' : 'none';
    }
    const btn = document.getElementById('toggleOutline');
    if (btn) btn.classList.toggle('active', this.isOutlineVisible);
  }

  toggleMinimap() {
    this.isMinimapVisible = !this.isMinimapVisible;
    const sidebar = document.getElementById('minimapSidebar');
    if (sidebar) {
      sidebar.style.display = this.isMinimapVisible ? 'flex' : 'none';
    }
    const btn = document.getElementById('toggleMinimap');
    if (btn) btn.classList.toggle('active', this.isMinimapVisible);
  }

  updateOutline() {
    if (!this.outlineContainer || !this.isOutlineVisible) return;

    const headings = [];
    const pagesArr = this.editor.yPages.toArray();

    pagesArr.forEach((pageMap, pageIndex) => {
      const yText = pageMap.get('content');
      if (!yText) return;

      const delta = yText.toDelta();
      let currentLineText = '';
      let currentLineStart = 0;
      let pos = 0;

      delta.forEach((op) => {
        if (op.insert) {
          if (typeof op.insert === 'string') {
            for (let i = 0; i < op.insert.length; i++) {
              const char = op.insert[i];
              if (char === '\n') {
                // End of line - check for header attribute
                if (op.attributes && op.attributes.header) {
                  // Clean text (remove excessive whitespace if needed, but keeping it raw is usually fine)
                  const text = currentLineText.trim();
                  if (text) {
                    headings.push({
                      level: op.attributes.header,
                      text: text,
                      pageIndex: pageIndex,
                      index: currentLineStart, // Start position of the heading line
                    });
                  }
                }
                currentLineText = '';
                currentLineStart = pos + 1;
              } else {
                currentLineText += char;
              }
              pos++;
            }
          } else {
            // Embed (image etc) - counts as 1 char
            pos++;
          }
        }
      });
    });

    if (headings.length === 0) {
      this.outlineContainer.innerHTML =
        '<div style="padding: 20px; color: #666; font-size: 12px;">No headings found</div>';
      return;
    }

    // Sidebar Tree Folding Logic
    let hideBelowLevel = Infinity;

    this.outlineContainer.innerHTML = headings
      .map((h, i) => {
        // Check if we should stop hiding
        if (h.level <= hideBelowLevel) {
          hideBelowLevel = Infinity;
        }

        // If we are currently hiding, return empty string (don't render this item)
        if (hideBelowLevel !== Infinity) {
          return '';
        }

        // Check if this item is collapsed
        const isCollapsed = this.collapsedSections.has(i);
        if (isCollapsed) {
          hideBelowLevel = h.level;
        }

        return `
      <div class="outline-item outline-h${h.level} ${isCollapsed ? 'collapsed' : ''}" data-index="${i}">
        <i class="fas ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'} fold-toggle" style="margin-right: 8px; width: 12px; cursor: pointer;"></i>
        ${this.escapeHTML(h.text || 'Untitled Section')}
      </div>
    `;
      })
      .join('');

    this.outlineContainer.querySelectorAll('.outline-item').forEach((el) => {
      const index = parseInt(el.dataset.index);
      const toggle = el.querySelector('.fold-toggle');

      toggle.onclick = (e) => {
        e.stopPropagation();
        this.toggleSection(index);
      };

      el.onclick = () => {
        const h = headings[index];
        this.editor.switchToPage(parseInt(h.pageIndex), h.index);

        // Highlight active
        this.outlineContainer
          .querySelectorAll('.outline-item')
          .forEach((item) => item.classList.remove('active'));
        el.classList.add('active');
      };
    });
  }

  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  toggleSection(index) {
    if (this.collapsedSections.has(index)) {
      this.collapsedSections.delete(index);
    } else {
      this.collapsedSections.add(index);
    }
    this.updateOutline();
  }

  // updateVisibility removed as it relied on unstable DOM manipulation

  updateMinimap() {
    if (!this.minimapContainer || !this.isMinimapVisible) return;

    // Simplified Minimap: Create a scaled down version of the pages
    this.minimapContainer.innerHTML = '';
    const pagesContainer = document.getElementById('pagesContainer');
    if (!pagesContainer) return;

    const clone = pagesContainer.cloneNode(true);
    clone.id = 'minimap-clone';
    clone.style.width = '1000px'; // Fixed width for scaling
    clone.style.transform = 'scale(0.12)';
    clone.style.transformOrigin = 'top left';
    clone.style.pointerEvents = 'none';
    clone.style.position = 'absolute';
    clone.style.top = '0';
    clone.style.left = '0';
    clone.style.padding = '0';
    clone.style.background = 'transparent';

    // Remove heavy elements from clone
    clone.querySelectorAll('.page-border-inner').forEach((el) => el.remove());

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = '120px';
    const totalHeight = pagesContainer.scrollHeight * 0.12;
    wrapper.style.height = `${totalHeight}px`;
    wrapper.appendChild(clone);

    this.minimapContainer.appendChild(wrapper);

    // Sync scroll
    this.minimapContainer.onclick = (e) => {
      const rect = wrapper.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const scrollTarget = y / 0.12;
      pagesContainer.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    };
  }

  handleTripleClick(e) {
    if (e.detail === 3) {
      const range = this.editor.quill?.getSelection();
      if (range) {
        const [line] = this.editor.quill.getLine(range.index);
        const index = this.editor.quill.getIndex(line);
        const length = line.length();
        this.editor.quill.setSelection(index, length, 'user');
      }
    }
  }
}
