import { get, set } from '/vendor/idb-keyval/index.js';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { QuillBinding } from 'y-quill';
import { PageManager } from '/js/features/editor/managers/PageManager.js';
import { BorderManager } from '/js/features/editor/managers/BorderManager.js';
import { CursorManager } from '/js/features/editor/managers/CursorManager.js';
import { SelectionManager } from '/js/features/editor/managers/SelectionManager.js';
import { ImageManager } from '/js/features/editor/managers/ImageManager.js';
import { ToolbarController } from '/js/features/ui/ToolbarController.js';
import { ReadabilityManager } from '/js/features/editor/managers/ReadabilityManager.js';
import { NavigationManager } from '/js/features/editor/managers/NavigationManager.js';
import { SearchManager } from '/js/features/editor/managers/SearchManager.js';
import { Auth } from '/js/features/auth/auth.js';
import { Network } from '/js/app/network.js';
import { debounce } from '/js/app/utils.js';

export class Editor {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (this.container) this.container.innerHTML = ''; // Clear static content
    this.quill = null; // Current active quill
    this.pageQuillInstances = new Map(); // pageId -> Quill
    this.pageBindings = new Map(); // pageId -> QuillBinding
    this.currentPageIndex = 0;
    this.currentZoom = 100;

    // Callbacks
    this.onPageChange = options.onPageChange || (() => {});
    this.onTitleChange = options.onTitleChange || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onCollaboratorsChange = options.onCollaboratorsChange || (() => {});

    this.initQuill();

    // Yjs Setup
    this.doc = new Y.Doc();
    const docId = new URLSearchParams(window.location.search).get('doc');
    const token = Auth.getToken();
    const user = options.user || { username: 'Anonymous', accentColor: '#ff0000' };
    this.user = user;
    this.currentDocId = docId;
    this.yPages = this.doc.getArray('pages');

    // Ready promise — resolves when pages first render, or after 10s safety fallback
    this._isReady = false;
    this._readyResolve = null;
    this.ready = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
    setTimeout(() => {
      if (this._readyResolve) this._readyResolve();
    }, 10000);

    this.plugins = new Map();

    // Register Core Plugins (Managers)
    this.pageManager = this.registerPlugin(PageManager);
    this.borderManager = this.registerPlugin(BorderManager);
    this.cursorManager = this.registerPlugin(CursorManager);
    this.selectionManager = this.registerPlugin(SelectionManager);
    this.imageManager = this.registerPlugin(ImageManager);
    this.toolbarController = this.registerPlugin(ToolbarController);
    this.readabilityManager = this.registerPlugin(ReadabilityManager);
    this.navigationManager = this.registerPlugin(NavigationManager);
    this.searchManager = this.registerPlugin(SearchManager);

    this.setupGlobalListeners();

    // 1. Instant Load from IndexedDB
    this.loadFromCache(docId).then(() => {
      // Only connect after cache check (or concurrently, but we apply cache first)
      this.connectWebSocket(docId, user);
    });

    this.yPages.observe((event) => {
      this.renderAllPages(event);
    });

    // Persistence: Save to IndexedDB on every update (debounced)
    this.doc.on(
      'update',
      debounce(() => {
        this.saveToCache(docId);
      }, 1000)
    );

    // Persistence: Save immediately on close
    window.addEventListener('beforeunload', () => {
      this.saveToCache(docId);
    });

    this.setupTitleDebounce();
    this.setupScrollListener();
    this.setupIntersectionObserver();

    // Render placeholder immediately for perceived performance
    this.createPlaceholderPage();
  }

  setupIntersectionObserver() {
    const options = {
      root: document.getElementById('pagesContainer'),
      rootMargin: '1200px 0px 1200px 0px',
      threshold: 0.01,
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const pageId = entry.target.dataset.pageId;
        if (!pageId) return;

        if (entry.isIntersecting) {
          this.mountPage(pageId);
        } else {
          this.unmountPage(pageId);
        }
      });
    }, options);
  }

  setupScrollListener() {
    const container = document.getElementById('pagesContainer');
    if (!container) return;

    container.addEventListener(
      'scroll',
      debounce(() => {
        if (document.activeElement && document.activeElement.closest('.ql-editor')) {
          const activePageEl = document.activeElement.closest('.editor-container');
          if (activePageEl) {
            const activeId = activePageEl.dataset.pageId;
            const pages = this.yPages.toArray();
            const activeIndex = pages.findIndex((p) => p.get('id') === activeId);

            if (activeIndex !== -1 && activeIndex !== this.currentPageIndex) {
              this.currentPageIndex = activeIndex;
              this.quill = this.pageQuillInstances.get(activeId);
              this.onPageChange(activeIndex);
              return;
            }
          }
        }

        const pages = this.container.querySelectorAll('.editor-container');
        let closestPageIndex = this.currentPageIndex;
        let minDistance = Infinity;

        const containerRect = container.getBoundingClientRect();
        const containerCenter = containerRect.top + containerRect.height / 2;
        const scale = this.currentZoom / 100;

        pages.forEach((page) => {
          const rect = page.getBoundingClientRect();
          const pageCenter = rect.top + rect.height / 2;
          const distance = Math.abs(pageCenter - containerCenter) / scale;

          if (distance < minDistance) {
            minDistance = distance;
            const pageId = page.dataset.pageId;
            closestPageIndex = this.yPages.toArray().findIndex((p) => p.get('id') === pageId);
          }
        });

        if (closestPageIndex !== -1 && closestPageIndex !== this.currentPageIndex) {
          this.currentPageIndex = closestPageIndex;
          const pageId = this.yPages.get(closestPageIndex).get('id');
          this.quill = this.pageQuillInstances.get(pageId) || null;
          this.onPageChange(closestPageIndex);
        }
      }, 150)
    );
  }

  async loadFromCache(docId) {
    if (!docId) return;
    console.log('[Editor] loadFromCache docId=', docId);
    try {
      const cachedUpdate = await get(`doc-store-${docId}`);
      if (cachedUpdate) {
        console.log('[Editor] cache hit for docId=', docId);
        Y.applyUpdate(this.doc, cachedUpdate);
        this.renderAllPages();

        // Restore View State
        const savedView = localStorage.getItem(`doc-view-${docId}`);
        if (savedView) {
          const { scrollTop, pageIndex, cursorIndex } = JSON.parse(savedView);

          // Wait for render
          setTimeout(() => {
            if (typeof pageIndex === 'number') {
              // Force switch to ensure mount
              this.switchToPage(pageIndex);

              // Restore Scroll
              const container = document.getElementById('pagesContainer');
              if (container && scrollTop) {
                container.scrollTop = scrollTop;
              }

              // Restore Cursor
              if (typeof cursorIndex === 'number' && this.quill) {
                // We need to wait for the Quill instance to be ready and focused
                this.quill.setSelection(cursorIndex, 0);
                this.quill.blur(); // Don't force focus immediately to avoid jumping if user is just viewing
              }
            }
          }, 100);
        }
      } else {
        console.log('[Editor] cache miss for docId=', docId);
      }
    } catch (err) {
      console.warn('[Editor] Failed to load from IndexedDB:', err);
    }
  }

  async saveToCache(docId) {
    if (!docId) return;

    // Save Yjs Update
    const update = Y.encodeStateAsUpdate(this.doc);
    await set(`doc-store-${docId}`, update);

    // Save View State
    const container = document.getElementById('pagesContainer');
    let cursorIndex = null;
    if (this.quill) {
      const range = this.quill.getSelection();
      if (range) cursorIndex = range.index;
    }

    const viewState = {
      scrollTop: container ? container.scrollTop : 0,
      pageIndex: this.currentPageIndex,
      cursorIndex: cursorIndex,
    };

    localStorage.setItem(`doc-view-${docId}`, JSON.stringify(viewState));

    // Save Instant Preview (HTML Snapshot)
    // We grab the HTML of the currently active page (or page 0 if possible)
    // Since we paginate, page 0 is usually the most relevant for "First Contentful Paint".
    // But we can just use the current Quill instance if available.
    if (this.quill && this.currentPageIndex === 0) {
      localStorage.setItem(`doc-preview-${docId}`, this.quill.root.innerHTML);
    } else {
      // Fallback: Try to find Page 0
      const pages = this.yPages.toArray();
      if (pages.length > 0) {
        const firstPageId = pages[0].get('id');
        // We need the DOM element
        const firstEditor = document.querySelector(`#editor-${firstPageId} .ql-editor`);
        if (firstEditor) {
          localStorage.setItem(`doc-preview-${docId}`, firstEditor.innerHTML);
        }
      }
    }
  }

  async connectWebSocket(docId, user) {
    console.log('[Editor] connectWebSocket docId=', docId);

    const config = window.SYNCROEDIT_CONFIG || {};
    const backend = config.REALTIME_BACKEND || 'node';
    let wsBaseUrl = Network.getWebSocketBaseUrl();

    if (backend === 'durable-object') {
      if (config.WS_BASE_URL) {
        wsBaseUrl = config.WS_BASE_URL;
      } else {
        const apiBaseUrl = config.API_BASE_URL;
        if (apiBaseUrl) {
          const urlObj = new URL(apiBaseUrl, window.location.origin);
          const protocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
          wsBaseUrl = `${protocol}//${urlObj.host}`;
        } else {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsBaseUrl = `${protocol}//${window.location.host}`;
        }
      }
      if (!wsBaseUrl.endsWith('/ws')) {
        wsBaseUrl = `${wsBaseUrl.replace(/\/+$/, '')}/ws`;
      }
    }

    let ticket;
    try {
      const data = await Network.fetchAPI('/api/auth/ws-ticket');
      ticket = data.ticket;
      console.log('[Editor] WS ticket received');
    } catch (err) {
      console.error('[Editor] Failed to get WS ticket:', err);
      setTimeout(() => this.connectWebSocket(docId, user), 1000);
      return;
    }

    if (this.provider) {
      this.provider.destroy();
    }

    this.provider = new WebsocketProvider(wsBaseUrl, docId, this.doc, {
      params: { ticket: ticket },
    });

    console.log('[Editor] WebsocketProvider created for docId=', docId);

    // Timeout: if sync never fires within 15s, show a visible error
    const syncTimeout = setTimeout(() => {
      if (!this.provider?.synced) {
        console.error('[Editor] Sync timeout — document server unreachable for docId:', docId);
        this._showSyncError();
        if (this._readyResolve) this._readyResolve();
      }
    }, 15000);

    this.provider.on('status', async ({ status }) => {
      this.onStatusChange(status);
      if (status === 'disconnected') {
        try {
          const data = await Network.fetchAPI('/api/auth/ws-ticket');
          if (data && data.ticket) {
            this.provider.params.ticket = data.ticket;
          }
        } catch (err) {
          console.warn('[WebSocket] Failed to refresh ticket:', err);
        }
      }
    });

    this.provider.on('sync', (isSynced) => {
      console.log('[Editor] sync isSynced=', isSynced, 'docId=', docId);
      clearTimeout(syncTimeout);
      if (isSynced) {
        const isNewDoc = this.yPages.length === 0;
        if (isNewDoc) {
          const newPage = new Y.Map();
          newPage.set('id', Math.random().toString(36).substr(2, 9));
          const content = new Y.Text();
          newPage.set('content', content);
          this.yPages.push([newPage]);
        }
        this.renderAllPages();
        if (isNewDoc) {
          this.switchToPage(0, 'start');
        }
        this.saveToCache(docId);
      }
    });
  }

  _showSyncError() {
    const placeholder = this.container?.querySelector('.loading-placeholder');
    if (placeholder) {
      placeholder.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:16px;color:#888;font-size:14px;">
          <div style="font-size:32px;color:#e57373;">&#9888;</div>
          <div>Could not connect to the document server.</div>
          <button onclick="window.location.reload()" style="padding:8px 20px;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:6px;cursor:pointer;font-size:13px;">Retry</button>
        </div>`;
      placeholder.style.opacity = '1';
    }
  }

  async reconnect(user = null) {
    if (user) this.user = user;
    const docId = new URLSearchParams(window.location.search).get('doc');
    await this.connectWebSocket(docId, this.user);
  }

  destroy() {
    console.log('[Editor] destroy docId=', this.currentDocId);
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.plugins.forEach((plugin) => {
      if (typeof plugin.destroy === 'function') plugin.destroy();
    });
    this.plugins.clear();
    this.pageQuillInstances.clear();
    this.pageBindings.clear();
    if (this.container) this.container.innerHTML = '';
  }

  updateUser(user) {
    this.user = user;
    if (this.provider && this.provider.awareness) {
      if (user.showOnlineStatus !== false) {
        this.provider.awareness.setLocalStateField('user', {
          username: user.username,
          profilePicture: user.profilePicture,
          color:
            user.accentColor ||
            user.color ||
            '#' + Math.floor(Math.random() * 16777215).toString(16),
        });
      } else {
        this.provider.awareness.setLocalStateField('user', null);
      }
    }
  }

  createPlaceholderPage() {
    const placeholderId = 'page-placeholder';
    if (document.getElementById(placeholderId)) return;

    const docId = new URLSearchParams(window.location.search).get('doc');
    const previewHtml = localStorage.getItem(`doc-preview-${docId}`);

    const newPageContainer = document.createElement('div');
    newPageContainer.className = 'editor-container loading-placeholder';
    newPageContainer.id = placeholderId;
    newPageContainer.style.opacity = previewHtml ? '0.5' : '0.7'; // Less opacity if we have content

    const contentHtml = previewHtml || '';
    const placeholderAttr = previewHtml ? '' : 'data-placeholder="Loading document..."';

    newPageContainer.innerHTML = `
              <div class="page-scaler" style="transform-origin: top center; height: 100%; width: 100%;">
                <div class="page-border-inner" style="position: absolute; top: 20px; left: 20px; right: 20px; bottom: 20px; pointer-events: none; border: 1px solid transparent; z-index: 5;"></div>
                <div class="page-editor ql-container ql-snow" style="position: relative; z-index: 1;">
                    <div class="ql-editor" ${placeholderAttr} contenteditable="false">${contentHtml}</div>
                </div>
              </div>
          `;

    this.container.appendChild(newPageContainer);
    const borderElement = newPageContainer.querySelector('.page-border-inner');
    if (borderElement) this.borderManager.applyBorderToElement(borderElement);
    this.applyZoom();
  }

  initQuill() {
    const Size = Quill.import('attributors/style/size');
    Size.whitelist = [
      '8px',
      '9px',
      '10px',
      '11px',
      '12px',
      '14px',
      '16px',
      '18px',
      '20px',
      '22px',
      '24px',
      '26px',
      '28px',
      '36px',
      '48px',
      '72px',
    ];
    Quill.register(Size, true);

    const Font = Quill.import('formats/font');
    Font.whitelist = [
      'roboto',
      'open-sans',
      'lato',
      'montserrat',
      'oswald',
      'merriweather',
      'arial',
      'times-new-roman',
      'courier-new',
      'georgia',
      'verdana',
      'lobster',
      'pacifico',
      'bebas-neue',
      'anton',
      'dancing-script',
      'shadows-into-light',
      'abril-fatface',
      'playfair-display',
      'indie-flower',
      'amatic-sc',
      'caveat',
      'comfortaa',
      'righteous',
      'cinzel',
      'poppins',
      'raleway',
      'nunito',
      'quicksand',
      'inconsolata',
      'ubuntu',
      'bitter',
      'dosis',
      'josefin-sans',
      'libre-baskerville',
      'mulish',
      'pt-sans',
      'pt-serif',
      'titillium-web',
      'varela-round',
      'zilla-slab',
      'fira-sans',
      'work-sans',
      'dm-sans',
      'ibm-plex-sans',
      'karla',
      'crimson-text',
      'source-sans-pro',
      'source-serif-pro',
      'space-mono',
      'exo-2',
      'kanit',
      'maven-pro',
      'signika',
      'bree-serif',
      'fjalla-one',
      'patua-one',
      'arvo',
      'vollkorn',
      'old-standard-tt',
      'great-vibes',
    ];
    Quill.register(Font, true);

    const Parchment = Quill.import('parchment');
    const Style = Parchment.Attributor.Style;

    const Width = new Style('width', 'width', { scope: Parchment.Scope.INLINE });
    const Height = new Style('height', 'height', { scope: Parchment.Scope.INLINE });
    const Float = new Style('float', 'float', {
      whitelist: ['left', 'right', 'none'],
      scope: Parchment.Scope.INLINE,
    });
    const Display = new Style('display', 'display', {
      whitelist: ['inline', 'block', 'inline-block'],
      scope: Parchment.Scope.INLINE,
    });
    const Margin = new Style('margin', 'margin', { scope: Parchment.Scope.INLINE });

    Quill.register(Width, true);
    Quill.register(Height, true);
    Quill.register(Float, true);
    Quill.register(Display, true);
    Quill.register(Margin, true);
  }

  setupTitleDebounce() {
    const docTitle = document.getElementById('docTitle');
    const meta = this.doc.getMap('meta');

    if (docTitle) {
      meta.observe((event) => {
        if (event.keysChanged.has('title')) {
          const newTitle = meta.get('title');
          if (docTitle.value !== newTitle) {
            docTitle.value = newTitle;
            this.onTitleChange(newTitle);
          }
        }
      });
      docTitle.addEventListener('input', (e) => {
        meta.set('title', e.target.value);
        this.onTitleChange(e.target.value);
      });
    }
  }

  renderAllPages(event = null) {
    if (!this.container) return;

    // Always clear placeholders if we have real pages
    if (this.yPages.length > 0) {
      const placeholders = this.container.querySelectorAll(
        '#page-placeholder, [id*="placeholder"]'
      );
      placeholders.forEach((p) => p.remove());
    }

    console.log('[Editor] renderAllPages pages=', this.yPages.length, 'event=', !!event);

    const pages = this.yPages.toArray();

    // Late Binding: Ensure existing pages get bound when provider becomes available
    if (this.provider && this.provider.awareness) {
      this.pageQuillInstances.forEach((quill, pageId) => {
        if (!this.pageBindings.has(pageId)) {
          const pageIndex = pages.findIndex((p) => p.get('id') === pageId);
          if (pageIndex !== -1) {
            const yText = pages[pageIndex].get('content');
            const binding = new QuillBinding(yText, quill, this.provider.awareness);
            this.pageBindings.set(pageId, binding);
          }
        }
      });
    }

    if (!event) {
      // Full Sync/Initial Render
      const existingContainers = Array.from(this.container.querySelectorAll('.editor-container'));
      const newIds = new Set(pages.map((p) => p.get('id')));

      existingContainers.forEach((c) => {
        const id = c.dataset.pageId;
        if (!id || !newIds.has(id)) {
          if (id) this.removePageById(id);
          else c.remove();
        }
      });

      pages.forEach((pageMap, index) => {
        let finalId = pageMap.get('id');
        if (!finalId) {
          finalId = Math.random().toString(36).substr(2, 9);
          pageMap.set('id', finalId);
        }
        const container = document.getElementById(`page-container-${finalId}`);
        if (!container) {
          this.createPageContainer(finalId, index);
        } else {
          if (this.container.children[index] !== container) {
            this.container.insertBefore(container, this.container.children[index]);
          }
        }
      });
    } else {
      // Truly Incremental Update via Delta
      let currentIndex = 0;
      event.delta.forEach((op) => {
        if (op.retain) {
          currentIndex += op.retain;
        } else if (op.insert) {
          const referenceNode = this.container.children[currentIndex];
          op.insert.forEach((pageMap) => {
            const pageId = pageMap.get('id') || Math.random().toString(36).substr(2, 9);
            if (!pageMap.has('id')) pageMap.set('id', pageId);
            this.createPageContainer(pageId, currentIndex, referenceNode);
            currentIndex++;
          });
        } else if (op.delete) {
          for (let i = 0; i < op.delete; i++) {
            const nodeToRemove = this.container.children[currentIndex];
            if (nodeToRemove) {
              this.removePageById(nodeToRemove.dataset.pageId);
            }
          }
        }
      });
    }

    // Update active quill reference if structure changed
    const currentPageMap = this.yPages.get(this.currentPageIndex);
    if (currentPageMap) {
      this.quill = this.pageQuillInstances.get(currentPageMap.get('id')) || null;
    }

    // Signal ready on first successful render with pages present
    if (!this._isReady && this.yPages.length > 0) {
      this._isReady = true;
      if (this._readyResolve) this._readyResolve();
    }
  }

  registerPlugin(PluginClass, options = {}) {
    const pluginName = PluginClass.name;
    if (this.plugins.has(pluginName)) {
      console.warn(`Plugin ${pluginName} is already registered.`);
      return this.plugins.get(pluginName);
    }

    const plugin = new PluginClass(this, options);
    this.plugins.set(pluginName, plugin);

    if (typeof plugin.init === 'function') {
      plugin.init();
    }

    return plugin;
  }

  getPlugin(name) {
    return this.plugins.get(name);
  }

  setupGlobalListeners() {
    this.container.addEventListener('click', (e) => {
      if (e.target === this.container && this.quill) {
        this.quill.focus();
      }
    });
  }

  // --- Virtualization & DOM Management ---

  createPageContainer(pageId, pageIndex, insertBeforeNode = null) {
    if (document.getElementById(`page-container-${pageId}`)) return;

    const newPageContainer = document.createElement('div');
    newPageContainer.className = 'editor-container';
    newPageContainer.id = `page-container-${pageId}`;
    newPageContainer.dataset.pageId = pageId;

    newPageContainer.innerHTML = `
            <div class="page-scaler">
                <div class="page-border-inner" style="position: absolute; top: 20px; left: 20px; right: 20px; bottom: 20px; pointer-events: none; border: 1px solid transparent; z-index: 5;"></div>
                <div id="editor-${pageId}" class="page-editor" data-page-id="${pageId}" style="position: relative; z-index: 1;"></div>
            </div>
        `;

    if (insertBeforeNode) {
      this.container.insertBefore(newPageContainer, insertBeforeNode);
    } else {
      this.container.appendChild(newPageContainer);
    }

    const borderElement = newPageContainer.querySelector('.page-border-inner');
    if (borderElement) this.borderManager.applyBorderToElement(borderElement);

    if (this.observer) this.observer.observe(newPageContainer);
  }

  mountPage(pageId) {
    if (this.pageQuillInstances.has(pageId)) return;

    const container = document.getElementById(`page-container-${pageId}`);
    if (!container) return;

    const pages = this.yPages.toArray();
    const pageIndex = pages.findIndex((p) => p.get('id') === pageId);
    const pageMap = pages[pageIndex];
    if (!pageMap) return;

    const pageQuill = new Quill(`#editor-${pageId}`, {
      theme: 'snow',
      placeholder: 'Start typing...',
      modules: {
        toolbar: false,
        syntax: { highlight: (text) => hljs.highlightAuto(text).value },
        history: { userOnly: true },
      },
    });

    this.pageQuillInstances.set(pageId, pageQuill);

    pageQuill.on('text-change', (delta, oldDelta, source) => {
      const currentIndex = this.yPages.toArray().findIndex((p) => p.get('id') === pageId);
      if (this.readabilityManager.showLineNumbers) {
        this.readabilityManager.updateGutter(currentIndex);
      }
      this.pageManager.handleContentChange(currentIndex, delta, source);
    });

    const yText = pageMap.get('content');
    if (this.provider && this.provider.awareness) {
      const binding = new QuillBinding(yText, pageQuill, this.provider.awareness);
      this.pageBindings.set(pageId, binding);
    }

    this.cursorManager.setupPageListeners(pageQuill, pageId);
    this.readabilityManager.onPageCreated(pageIndex, container);

    const qlEditor = container.querySelector('.ql-editor');
    if (qlEditor) {
      qlEditor.addEventListener('keydown', (e) => this.handleKeyDown(e), true);
    }
  }

  unmountPage(pageId) {
    if (!this.pageQuillInstances.has(pageId)) return;

    // PROTECTION: Never unmount the currently active page.
    // IntersectionObserver might fire before initial layout or focus is ready.
    const currentPageMap = this.yPages.get(this.currentPageIndex);
    if (currentPageMap && currentPageMap.get('id') === pageId) {
      return;
    }

    // Protection for focused editor
    if (document.activeElement && document.activeElement.closest(`#editor-${pageId}`)) {
      return;
    }

    const binding = this.pageBindings.get(pageId);
    if (binding) {
      binding.destroy();
      this.pageBindings.delete(pageId);
    }

    this.pageQuillInstances.delete(pageId);

    const editorDiv = document.getElementById(`editor-${pageId}`);
    if (editorDiv) {
      editorDiv.innerHTML = '';
      editorDiv.className = 'page-editor';
      editorDiv.dataset.pageId = pageId;
    }
  }

  removePageById(pageId) {
    const container = document.getElementById(`page-container-${pageId}`);
    if (container) {
      if (this.observer) this.observer.unobserve(container);
      container.remove();
    }
    this.unmountPage(pageId);
  }

  handleKeyDown(e) {
    const container = e.target.closest('.editor-container');
    if (!container) return;
    const pageId = container.dataset.pageId;
    const pages = this.yPages.toArray();
    const pageIndex = pages.findIndex((p) => p.get('id') === pageId);

    const pageQuill = this.pageQuillInstances.get(pageId);
    if (!pageQuill) return;

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.pageManager.insertPageBreak(pageIndex);
      return;
    }

    if (e.key === 'Enter') {
      const range = pageQuill.getSelection();
      if (range) {
        const isAtBottom = this.pageManager.isCursorAtBottom(pageIndex, range.index);
        if (isAtBottom) {
          e.preventDefault();
          this.pageManager.insertPageBreak(pageIndex);
          return;
        }
      }
    }

    if (e.key === 'Backspace' && pageIndex > 0) {
      const range = pageQuill.getSelection();
      if ((range && range.index === 0 && range.length === 0) || pageQuill.getLength() <= 1) {
        e.preventDefault();
        this.pageManager.mergeWithPreviousPage(pageIndex);
        return;
      }
    }

    if (e.key === 'ArrowLeft' && pageIndex > 0) {
      const range = pageQuill.getSelection();
      if (range && range.index === 0) {
        e.preventDefault();
        this.switchToPage(pageIndex - 1, 'end', 'auto');
      }
    }

    if (e.key === 'ArrowRight' && pageIndex < this.yPages.length - 1) {
      const range = pageQuill.getSelection();
      if (range && range.index >= pageQuill.getLength() - 1) {
        e.preventDefault();
        this.switchToPage(pageIndex + 1, 'start', 'auto');
      }
    }

    if (e.key === 'ArrowUp' && pageIndex > 0) {
      const range = pageQuill.getSelection();
      if (range) {
        const [line] = pageQuill.getLine(range.index);
        if (!line.prev) {
          e.preventDefault();
          this.switchToPage(pageIndex - 1, 'end', 'auto');
        }
      }
    }

    if (e.key === 'ArrowDown' && pageIndex < this.yPages.length - 1) {
      const range = pageQuill.getSelection();
      if (range) {
        const [line] = pageQuill.getLine(range.index);
        if (!line.next) {
          e.preventDefault();
          this.switchToPage(pageIndex + 1, 'start', 'auto');
        }
      }
    }
  }

  addNewPage() {
    const newPage = new Y.Map();
    newPage.set('id', Math.random().toString(36).substr(2, 9));
    const content = new Y.Text();
    newPage.set('content', content);
    this.yPages.push([newPage]);
  }

  deletePage(index) {
    if (this.yPages.length > 1) {
      this.yPages.delete(index, 1);
    }
  }

  isPageEffectivelyEmpty(pageIndex) {
    const pageMap = this.yPages.get(pageIndex);
    if (!pageMap) return false;
    const quill = this.pageQuillInstances.get(pageMap.get('id'));
    if (!quill) return false;
    const text = quill.getText().trim();
    return quill.getLength() <= 1 || text === '';
  }

  removeTrailingEmptyPage(pageIndex) {
    const isLastPage = pageIndex === this.yPages.length - 1;
    if (!isLastPage || this.yPages.length <= 1) return false;
    if (!this.isPageEffectivelyEmpty(pageIndex)) return false;
    this.deletePage(pageIndex);
    return true;
  }

  switchToPage(pageIndex, cursorPosition = null, scrollBehavior = 'smooth') {
    const leavingIndex = this.currentPageIndex;
    const pageChanged = pageIndex !== leavingIndex;

    if (pageChanged) {
      const removed = this.removeTrailingEmptyPage(leavingIndex);
      if (removed && pageIndex >= this.yPages.length) {
        pageIndex = this.yPages.length - 1;
      }
    }

    if (pageIndex < 0 || pageIndex >= this.yPages.length) return;

    this.currentPageIndex = pageIndex;
    const pageId = this.yPages.get(pageIndex).get('id');

    this.mountPage(pageId);
    this.quill = this.pageQuillInstances.get(pageId);

    if (this.quill) {
      this.quill.focus();

      if (typeof cursorPosition === 'number') {
        this.quill.setSelection(cursorPosition, 0);
      } else if (cursorPosition === 'end') {
        this.quill.setSelection(Math.max(0, this.quill.getLength() - 1), 0);
      } else if (cursorPosition === 'start') {
        this.quill.setSelection(0, 0);
      }

      // Only scroll if we actually moved to a different page
      if (pageChanged) {
        const numericIndex = typeof cursorPosition === 'number' ? cursorPosition : null;
        this.cursorManager.scrollToCursor(pageIndex, scrollBehavior, numericIndex);
      }
      this.onPageChange(pageIndex);

      // --- PREDICTIVE MOUNTING ---
      // Pre-mount neighbors to eliminate virtualization lag during navigation
      requestIdleCallback(() => {
        if (pageIndex > 0) {
          const prevId = this.yPages.get(pageIndex - 1).get('id');
          this.mountPage(prevId);
        }
        if (pageIndex < this.yPages.length - 1) {
          const nextId = this.yPages.get(pageIndex + 1).get('id');
          this.mountPage(nextId);
        }
      });
    }
  }

  setPageSize(sizeName) {
    if (this.pageManager) this.pageManager.setPageSize(sizeName);
    this.applyZoom();
  }

  applyZoom() {
    const scale = this.currentZoom / 100;
    const pageWidth = this.pageManager ? this.pageManager.PAGE_WIDTH : 816;
    const pageHeight = this.pageManager ? this.pageManager.PAGE_HEIGHT : 1056;

    document.documentElement.style.setProperty('--page-scale', scale);
    document.documentElement.style.setProperty('--page-width', `${pageWidth}px`);
    document.documentElement.style.setProperty('--page-height', `${pageHeight}px`);

    if (this.pageManager) {
      this.pageManager.updateWaterline();
    }
  }

  get pages() {
    return this.yPages.toArray().map((map) => ({ content: map.get('content'), id: map.get('id') }));
  }
}
