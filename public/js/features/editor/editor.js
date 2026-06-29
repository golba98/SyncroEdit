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
import { Network } from '/js/app/network.js';
import { debounce } from '/js/app/utils.js';

export class Editor {
  constructor(containerId, options = {}) {
    this.debug = Boolean(options.debug || window.SYNCROEDIT_CONFIG?.DEBUG);
    this.container = document.getElementById(containerId);
    if (this.container) this.container.replaceChildren(); // Clear static content
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
    this.onContentReady = options.onContentReady || (() => {});
    this.onLifecycleChange = options.onLifecycleChange || (() => {});
    this.onSaveStatusChange = options.onSaveStatusChange || (() => {});
    this.onStatsChange = options.onStatsChange || (() => {});
    this.onSelectionStatsChange = options.onSelectionStatsChange || (() => {});
    this.isNewDocument = Boolean(options.isNewDocument);

    this.initQuill();

    // Yjs Setup
    this.doc = new Y.Doc();
    const docId = new URLSearchParams(window.location.search).get('doc');
    const user = options.user || {
      username: 'Anonymous',
      accentColor: '#ff0000',
    };
    this.user = user;
    this.currentDocId = docId;
    this.yPages = this.doc.getArray('pages');
    this.provider = null;
    this.providerDocId = null;
    this._connectionGeneration = 0;
    this._destroyed = false;
    this._intentionalProviderClose = false;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._syncTimeout = null;
    this._hasReceivedInitialSync = false;
    this._hasLoadedDocumentContent = false;
    this._readyForUser = false;
    this._lastSaveStatus = 'saved';
    this._hasLoggedTyping = false;

    // Ready promise — resolves when pages first render, or after 10s safety fallback
    this._isReady = false;
    this._readyResolve = null;
    this.ready = new Promise((resolve) => {
      this._readyResolve = resolve;
    });
    this._readySafetyTimer = setTimeout(() => {
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
    this._emitLifecycle('loading-document');
    this.loadFromCache(docId).then(() => {
      // Only connect after cache check (or concurrently, but we apply cache first)
      this.connectWebSocket(docId, user);
    });

    this.yPages.observe((event) => {
      this.renderAllPages(event);
    });

    // 50ms debounced stats update
    this.updateStatsDebounced = debounce(() => this.updateStats(), 50);

    // Persistence: Save to IndexedDB on every update (debounced)
    let hasLocalChanges = false;
    const debouncedSave = debounce(() => {
      if (this._destroyed) return;
      const docId = this.currentDocId;
      if (!docId) return;

      const shouldUpdateUI = hasLocalChanges;
      hasLocalChanges = false;

      if (shouldUpdateUI) {
        this._setSaveStatus('saving');
      }

      this.saveToCache(docId)
        .then(() => {
          if (shouldUpdateUI) {
            this._setSaveStatus(navigator.onLine === false ? 'offline' : 'saved');
          }
        })
        .catch(() => {
          if (shouldUpdateUI) {
            this._setSaveStatus('failed');
          }
        });
    }, 1000);

    if (typeof this.doc.on === 'function') {
      this.doc.on('update', (update, origin) => {
        if (this._destroyed) return;

        const isRemote =
          (origin === this.provider && this.provider !== null) ||
          (origin && origin.constructor && origin.constructor.name === 'WebsocketProvider');

        // Stats updates: immediate if remote or empty text, else debounced at 50ms
        if (isRemote || this.isDocumentTextEmpty()) {
          this.updateStats();
        } else {
          this.updateStatsDebounced();
        }

        if (this._readyForUser) {
          if (!isRemote) {
            hasLocalChanges = true;
            this._setSaveStatus('unsaved');
          }
          debouncedSave();
        }
      });
    }

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

  _log(...args) {
    if (this.debug) {
      console.log(...args);
    }
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
    this._log('[Editor] loadFromCache docId=', docId);
    try {
      const cachedUpdate = await get(`doc-store-${docId}`);
      if (cachedUpdate) {
        this._log('[Editor] cache hit for docId=', docId);
        Y.applyUpdate(this.doc, cachedUpdate);
        this.renderAllPages();
        this._hasLoadedDocumentContent = this.yPages.length > 0;
        this._emitLifecycle('loading-document', {
          title: 'Opening cached document...',
          description: 'Showing local content while sync starts.',
        });

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
        this._log('[Editor] cache miss for docId=', docId);
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

    // Save Instant Preview (plain text snapshot)
    // We grab the text of the currently active page (or page 0 if possible)
    // Since we paginate, page 0 is usually the most relevant for "First Contentful Paint".
    // But we can just use the current Quill instance if available.
    if (this.quill && this.currentPageIndex === 0) {
      localStorage.setItem(`doc-preview-${docId}`, this.quill.getText());
    } else {
      // Fallback: Try to find Page 0
      const pages = this.yPages.toArray();
      if (pages.length > 0) {
        const firstPageId = pages[0].get('id');
        // We need the DOM element
        const firstEditor = document.querySelector(`#editor-${firstPageId} .ql-editor`);
        if (firstEditor) {
          localStorage.setItem(`doc-preview-${docId}`, firstEditor.textContent || '');
        }
      }
    }
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _clearSyncTimeout() {
    if (this._syncTimeout) {
      clearTimeout(this._syncTimeout);
      this._syncTimeout = null;
    }
  }

  _describeProviderClose(event, provider) {
    return {
      docId: this.currentDocId,
      type: event?.type || 'close',
      code: typeof event?.code === 'number' ? event.code : null,
      reason: event?.reason || '',
      wasClean: typeof event?.wasClean === 'boolean' ? event.wasClean : null,
      readyState: provider?.ws?.readyState ?? null,
      wsconnected: Boolean(provider?.wsconnected),
      wsconnecting: Boolean(provider?.wsconnecting),
      synced: Boolean(provider?.synced),
    };
  }

  _destroyProvider() {
    this._clearReconnectTimer();
    this._clearSyncTimeout();
    if (!this.provider) return;

    this._intentionalProviderClose = true;
    try {
      if (typeof this.provider.destroy === 'function') {
        this.provider.destroy();
      }
    } finally {
      this._intentionalProviderClose = false;
      this.provider = null;
      this.providerDocId = null;
      this.pageBindings.forEach((binding) => {
        if (typeof binding.destroy === 'function') binding.destroy();
      });
      this.pageBindings.clear();
    }
  }

  async _fetchWsTicket() {
    const data = await Network.fetchAPI('/api/auth/ws-ticket');
    if (!data || !data.ticket) {
      throw new Error('WebSocket ticket response missing ticket');
    }
    return data.ticket;
  }

  _scheduleReconnect(docId, generation, reason) {
    if (this._destroyed || generation !== this._connectionGeneration || this._reconnectTimer) {
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 30000);
    this._reconnectAttempts += 1;
    this.onStatusChange('reconnecting');

    console.warn('[Editor] Scheduling WebSocket reconnect', {
      docId,
      reason,
      delay,
    });

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._destroyed || generation !== this._connectionGeneration) return;

      const provider = this.provider;
      if (!provider || this.providerDocId !== docId) {
        await this.connectWebSocket(docId, this.user);
        return;
      }

      try {
        provider.params.ticket = await this._fetchWsTicket();
        if (
          this._destroyed ||
          generation !== this._connectionGeneration ||
          provider !== this.provider
        ) {
          return;
        }
        provider.shouldConnect = true;
        provider.connect();
      } catch (err) {
        console.error('[Editor] Failed to refresh WS ticket before reconnect:', err);
        this._scheduleReconnect(docId, generation, 'ticket-refresh-failed');
      }
    }, delay);
  }

  _startSyncTimeout(docId, generation) {
    this._clearSyncTimeout();
    this._syncTimeout = setTimeout(() => {
      if (
        this._destroyed ||
        generation !== this._connectionGeneration ||
        this._hasReceivedInitialSync
      ) {
        return;
      }

      console.error('[Editor] Sync timeout - initial document state not received', {
        docId,
        pages: this.yPages.length,
        wsconnected: Boolean(this.provider?.wsconnected),
        wsconnecting: Boolean(this.provider?.wsconnecting),
        synced: Boolean(this.provider?.synced),
      });
      if (this.yPages.length > 0) {
        this._emitLifecycle('ready', {
          title: 'Offline editing enabled',
          description:
            'Document content loaded locally. Changes will sync when the connection returns.',
        });
        this.onStatusChange('offline');
        this._setSaveStatus('offline');
        this._markReadyForUser('local-cache-timeout');
        return;
      }

      this._showSyncError();
      this._emitLifecycle('error', {
        message: 'Could not connect to the document server.',
      });
      if (this._readyResolve) this._readyResolve();
    }, 15000);
  }

  async connectWebSocket(docId, user) {
    this._log('[Editor] connectWebSocket docId=', docId);
    if (!docId || this._destroyed) return null;
    if (!this._readyForUser) this._emitLifecycle('connecting');
    if (user) this.user = user;
    this.currentDocId = docId;

    if (
      this.provider &&
      this.providerDocId === docId &&
      (this.provider.wsconnected || this.provider.wsconnecting || this._reconnectTimer)
    ) {
      this.updateUser(this.user);
      return this.provider;
    }

    const generation = ++this._connectionGeneration;
    if (!this._readyForUser) this._hasReceivedInitialSync = false;
    this._clearReconnectTimer();

    const config = window.SYNCROEDIT_CONFIG || {};
    const backend = config.REALTIME_BACKEND || 'durable-object';
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
      ticket = await this._fetchWsTicket();
      this._log('[Editor] WS ticket received');
    } catch (err) {
      console.error('[Editor] Failed to get WS ticket:', err);
      this._scheduleReconnect(docId, generation, 'initial-ticket-fetch-failed');
      return null;
    }

    if (this._destroyed || generation !== this._connectionGeneration) {
      return null;
    }

    this._destroyProvider();
    this._connectionGeneration = generation;

    this.provider = new WebsocketProvider(wsBaseUrl, docId, this.doc, {
      params: { ticket: ticket },
      connect: false,
      maxBackoffTime: 30000,
    });
    this.providerDocId = docId;
    this.updateUser(this.user);

    this._log('[Editor] WebsocketProvider created for docId=', docId);

    if (!this._readyForUser) this._startSyncTimeout(docId, generation);

    this.provider.on('status', async ({ status }) => {
      if (this._destroyed || generation !== this._connectionGeneration) return;
      this.onStatusChange(status);
      if (status === 'connected') {
        this._reconnectAttempts = 0;
        if (!this._readyForUser) {
          this._emitLifecycle('syncing');
        }
      }
    });

    this.provider.on('connection-error', (event, provider) => {
      if (
        this._destroyed ||
        generation !== this._connectionGeneration ||
        provider !== this.provider
      ) {
        return;
      }
      console.error(
        '[Editor] WebSocket connection error',
        this._describeProviderClose(event, provider)
      );
    });

    this.provider.on('connection-close', (event, provider) => {
      if (
        this._destroyed ||
        generation !== this._connectionGeneration ||
        provider !== this.provider
      ) {
        return;
      }

      const details = this._describeProviderClose(event, provider);
      console.warn('[Editor] WebSocket connection closed', details);

      if (this._intentionalProviderClose || provider.shouldConnect === false) {
        return;
      }

      provider.shouldConnect = false;
      this._scheduleReconnect(docId, generation, 'unexpected-close');
    });

    this.provider.on('sync', (isSynced) => {
      if (this._destroyed || generation !== this._connectionGeneration) return;
      this._log('[Editor] sync isSynced=', isSynced, 'docId=', docId);
      if (!isSynced) return;

      this._hasReceivedInitialSync = true;
      this._clearSyncTimeout();
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
        this._markReadyForUser('initial-sync');
      }
    });

    this.provider.connect();
    return this.provider;
  }

  _showSyncError() {
    const placeholder = this.container?.querySelector('.loading-placeholder');
    if (placeholder) {
      const errorContainer = document.createElement('div');
      errorContainer.style.display = 'flex';
      errorContainer.style.flexDirection = 'column';
      errorContainer.style.alignItems = 'center';
      errorContainer.style.justifyContent = 'center';
      errorContainer.style.height = '300px';
      errorContainer.style.gap = '16px';
      errorContainer.style.color = '#888';
      errorContainer.style.fontSize = '14px';

      const warning = document.createElement('div');
      warning.style.fontSize = '32px';
      warning.style.color = '#e57373';
      warning.textContent = '\u26A0';

      const message = document.createElement('div');
      message.textContent = 'Could not connect to the document server.';

      const retryButton = document.createElement('button');
      retryButton.style.padding = '8px 20px';
      retryButton.style.background = '#333';
      retryButton.style.color = '#e0e0e0';
      retryButton.style.border = '1px solid #555';
      retryButton.style.borderRadius = '6px';
      retryButton.style.cursor = 'pointer';
      retryButton.style.fontSize = '13px';
      retryButton.textContent = 'Retry';
      retryButton.addEventListener('click', () => window.location.reload());

      errorContainer.append(warning, message, retryButton);
      placeholder.replaceChildren(errorContainer);
      placeholder.style.opacity = '1';
    }
  }

  async reconnect(user = null) {
    if (user) this.user = user;
    const docId = new URLSearchParams(window.location.search).get('doc');
    if (!docId || this._destroyed) return;
    this.updateUser(this.user);

    if (this.provider && this.providerDocId === docId) {
      if (this.provider.wsconnected || this.provider.wsconnecting || this._reconnectTimer) return;
      const generation = this._connectionGeneration;
      this._scheduleReconnect(docId, generation, 'explicit-reconnect');
      return;
    }

    await this.connectWebSocket(docId, this.user);
  }

  destroy() {
    this._log('[Editor] destroy docId=', this.currentDocId);
    this._destroyed = true;
    this._connectionGeneration++;
    if (this._readySafetyTimer) {
      clearTimeout(this._readySafetyTimer);
      this._readySafetyTimer = null;
    }
    this._destroyProvider();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this._selectionChangeListener) {
      document.removeEventListener('selectionchange', this._selectionChangeListener);
    }
    if (this._undoRedoKeyListener) {
      document.removeEventListener('keydown', this._undoRedoKeyListener);
    }
    if (this._undoRedoInputListener) {
      document.removeEventListener('input', this._undoRedoInputListener);
    }
    if (this._pasteListener) {
      document.removeEventListener('paste', this._pasteListener);
    }

    this.plugins.forEach((plugin) => {
      if (typeof plugin.destroy === 'function') plugin.destroy();
    });
    this.plugins.clear();
    this.pageQuillInstances.clear();
    this.pageBindings.clear();
    if (this.container) this.container.replaceChildren();
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
    const previewText = localStorage.getItem(`doc-preview-${docId}`);

    const newPageContainer = document.createElement('div');
    newPageContainer.className = 'editor-container loading-placeholder';
    newPageContainer.id = placeholderId;
    newPageContainer.style.opacity = previewText ? '0.5' : '0.7'; // Less opacity if we have content

    const pageScaler = document.createElement('div');
    pageScaler.className = 'page-scaler';
    pageScaler.style.transformOrigin = 'top center';
    pageScaler.style.height = '100%';
    pageScaler.style.width = '100%';

    const borderInner = document.createElement('div');
    borderInner.className = 'page-border-inner';
    borderInner.style.position = 'absolute';
    borderInner.style.top = '20px';
    borderInner.style.left = '20px';
    borderInner.style.right = '20px';
    borderInner.style.bottom = '20px';
    borderInner.style.pointerEvents = 'none';
    borderInner.style.border = '1px solid transparent';
    borderInner.style.zIndex = '5';

    const pageEditor = document.createElement('div');
    pageEditor.className = 'page-editor ql-container ql-snow';
    pageEditor.style.position = 'relative';
    pageEditor.style.zIndex = '1';

    const qlEditor = document.createElement('div');
    qlEditor.className = 'ql-editor';
    qlEditor.contentEditable = 'false';
    if (!previewText) {
      qlEditor.dataset.placeholder = 'Loading document...';
    }

    pageEditor.append(qlEditor);
    pageScaler.append(borderInner, pageEditor);
    newPageContainer.replaceChildren(pageScaler);

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
    const Style = Parchment.StyleAttributor || Parchment.Attributor.Style;

    const Width = new Style('width', 'width', {
      scope: Parchment.Scope.INLINE,
    });
    const Height = new Style('height', 'height', {
      scope: Parchment.Scope.INLINE,
    });
    const Float = new Style('float', 'float', {
      whitelist: ['left', 'right', 'none'],
      scope: Parchment.Scope.INLINE,
    });
    const Display = new Style('display', 'display', {
      whitelist: ['inline', 'block', 'inline-block'],
      scope: Parchment.Scope.INLINE,
    });
    const Margin = new Style('margin', 'margin', {
      scope: Parchment.Scope.INLINE,
    });

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

    this._log('[Editor] renderAllPages pages=', this.yPages.length, 'event=', !!event);

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

    if (this.yPages.length > 0) {
      this._hasLoadedDocumentContent = true;
      this.onContentReady();
    }
  }

  _emitLifecycle(state, detail = {}) {
    if (this._destroyed) return;
    if (this._readyForUser && (state === 'connecting' || state === 'syncing')) {
      return;
    }
    this.onLifecycleChange(state, detail);
  }

  _setSaveStatus(status) {
    if (this._lastSaveStatus === status) return;
    this._lastSaveStatus = status;
    this.onSaveStatusChange(status);
  }

  hasLoadedDocumentContent() {
    return this._hasLoadedDocumentContent || this.yPages.length > 0;
  }

  isReadyForUser() {
    return this._readyForUser;
  }

  _markReadyForUser(reason) {
    if (this._readyForUser || this._destroyed) return;
    this._readyForUser = true;
    this._hasLoadedDocumentContent = this.yPages.length > 0;
    this._applyReadyPlaceholders();
    this._emitLifecycle('ready', {
      title: reason === 'initial-sync' ? 'Synced' : 'Ready',
      description:
        reason === 'initial-sync'
          ? 'The latest document state is ready.'
          : 'Document content is available locally.',
    });
    if (this._readyResolve) this._readyResolve();
    this.onContentReady();

    this.updateStats();

    requestAnimationFrame(() => {
      if (this._destroyed || !this.quill) return;
      try {
        this.quill.focus();
      } catch {}
    });
  }

  _applyReadyPlaceholders() {
    this.container
      ?.querySelectorAll('.ql-editor')
      .forEach((editorEl) => editorEl.setAttribute('data-placeholder', 'Start typing...'));
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

    this._selectionChangeListener = () => this.updateSelectionStats();
    this._undoRedoKeyListener = (e) => {
      const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey;
      const isRedo = (e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey));
      if (isUndo || isRedo) {
        setTimeout(() => this.updateStats(), 0);
      }
    };
    this._undoRedoInputListener = (e) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        setTimeout(() => this.updateStats(), 0);
      }
    };
    this._pasteListener = () => {
      setTimeout(() => this.updateStats(), 0);
    };

    document.addEventListener('selectionchange', this._selectionChangeListener);
    document.addEventListener('keydown', this._undoRedoKeyListener);
    document.addEventListener('input', this._undoRedoInputListener);
    document.addEventListener('paste', this._pasteListener);
  }

  // --- Virtualization & DOM Management ---

  createPageContainer(pageId, pageIndex, insertBeforeNode = null) {
    if (document.getElementById(`page-container-${pageId}`)) return;

    const newPageContainer = document.createElement('div');
    newPageContainer.className = 'editor-container';
    newPageContainer.id = `page-container-${pageId}`;
    newPageContainer.dataset.pageId = pageId;

    const pageScaler = document.createElement('div');
    pageScaler.className = 'page-scaler';

    const borderInner = document.createElement('div');
    borderInner.className = 'page-border-inner';
    borderInner.style.position = 'absolute';
    borderInner.style.top = '20px';
    borderInner.style.left = '20px';
    borderInner.style.right = '20px';
    borderInner.style.bottom = '20px';
    borderInner.style.pointerEvents = 'none';
    borderInner.style.border = '1px solid transparent';
    borderInner.style.zIndex = '5';

    const pageEditor = document.createElement('div');
    pageEditor.id = `editor-${pageId}`;
    pageEditor.className = 'page-editor';
    pageEditor.dataset.pageId = pageId;
    pageEditor.style.position = 'relative';
    pageEditor.style.zIndex = '1';

    pageScaler.append(borderInner, pageEditor);
    newPageContainer.replaceChildren(pageScaler);

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
      placeholder: this._readyForUser ? 'Start typing...' : '',
      modules: {
        toolbar: false,
        syntax: { highlight: (text) => hljs.highlightAuto(text).value },
        history: { userOnly: true },
      },
    });

    this.pageQuillInstances.set(pageId, pageQuill);

    pageQuill.on('text-change', (delta, oldDelta, source) => {
      if (source === 'user' && !this._hasLoggedTyping) {
        this._hasLoggedTyping = true;
      }
      const currentIndex = this.yPages.toArray().findIndex((p) => p.get('id') === pageId);
      if (this.readabilityManager.showLineNumbers) {
        this.readabilityManager.updateGutter(currentIndex);
      }
      this.pageManager.handleContentChange(currentIndex, delta, source);

      if (source === 'api') {
        this.updateStats();
      }
    });

    pageQuill.on('selection-change', () => {
      this.updateSelectionStats();
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
      editorDiv.replaceChildren();
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

  isDocumentTextEmpty() {
    try {
      const pages = this.yPages.toArray();
      if (pages.length === 0) return true;
      for (const page of pages) {
        const yText = page.get('content');
        if (yText && yText.toString().replace(/\n/g, '').trim().length > 0) {
          return false;
        }
      }
      return true;
    } catch {
      return true;
    }
  }

  updateStats() {
    if (this._destroyed) return;

    try {
      const pages = this.yPages.toArray();
      const pageTextsForChars = [];
      const pageTextsForWords = [];

      for (const page of pages) {
        const yText = page.get('content');
        let text = yText ? yText.toString() : '';
        if (text.endsWith('\n')) {
          text = text.slice(0, -1);
        }
        pageTextsForChars.push(text);
        pageTextsForWords.push(text);
      }

      // Join characters with "" (preventing artificial characters)
      const charText = pageTextsForChars.join('').normalize();
      const charCount = Array.from(charText).length;

      // Join words with " " (separating word boundaries across pages)
      const wordText = pageTextsForWords.join(' ').normalize();
      const wordRegex = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu;
      const wordsMatch = wordText.match(wordRegex);
      const wordCount = wordsMatch ? wordsMatch.length : 0;

      const stats = { wordCount, charCount };

      if (this.onStatsChange) {
        this.onStatsChange(stats);
      }
    } catch (err) {
      console.error('Error in updateStats:', err);
    }
  }

  getSelectedText() {
    try {
      // 1. Check if we have a multi-page selection in progress or completed
      if (
        this.selectionManager &&
        this.selectionManager.startPoint &&
        this.selectionManager.currentPoint
      ) {
        let start = this.selectionManager.startPoint;
        let end = this.selectionManager.currentPoint;
        if (
          start.pageIndex !== end.pageIndex ||
          (start.pageIndex === end.pageIndex && start.index !== end.index)
        ) {
          // Normalize
          if (
            start.pageIndex > end.pageIndex ||
            (start.pageIndex === end.pageIndex && start.index > end.index)
          ) {
            [start, end] = [end, start];
          }

          if (start.pageIndex !== end.pageIndex) {
            // Multi-page selection
            let text = '';
            const pagesArr = this.yPages.toArray();
            for (let i = start.pageIndex; i <= end.pageIndex; i++) {
              const pageMap = pagesArr[i];
              if (!pageMap) continue;
              const quill = this.pageQuillInstances.get(pageMap.get('id'));
              if (!quill) continue;

              let pStart = 0;
              let pEnd = quill.getLength();

              if (i === start.pageIndex) pStart = start.index;
              if (i === end.pageIndex) pEnd = end.index;

              const length = Math.max(0, pEnd - pStart);
              text += quill.getText(pStart, length);
            }
            return text;
          }
        }
      }

      // 2. Fallback: single page selection check on focused/active Quill
      if (this.quill) {
        const range = this.quill.getSelection();
        if (range && range.length > 0) {
          return this.quill.getText(range.index, range.length);
        }
      }

      // 3. Fallback: check all Quill instances to see if any has a selection
      for (const quill of this.pageQuillInstances.values()) {
        const range = quill.getSelection();
        if (range && range.length > 0) {
          return quill.getText(range.index, range.length);
        }
      }
    } catch (err) {
      console.error('Error getting selected text:', err);
    }
    return '';
  }

  updateSelectionStats() {
    try {
      const selectedText = this.getSelectedText() || '';
      const cleanText = selectedText.replace(/\r/g, '').normalize();
      const charCount = Array.from(cleanText).length;

      const wordRegex = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu;
      const wordsMatch = cleanText.match(wordRegex);
      const wordCount = wordsMatch ? wordsMatch.length : 0;

      if (charCount > 0) {
        if (this.onSelectionStatsChange) {
          this.onSelectionStatsChange({ wordCount, charCount, hasSelection: true });
        }
      } else {
        if (this.onSelectionStatsChange) {
          this.onSelectionStatsChange({ wordCount: 0, charCount: 0, hasSelection: false });
        }
      }
    } catch (err) {
      console.error('Error updating selection stats:', err);
    }
  }

  get pages() {
    return this.yPages.toArray().map((map) => ({ content: map.get('content'), id: map.get('id') }));
  }
}
