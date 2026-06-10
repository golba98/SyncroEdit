import { Auth } from '/js/features/auth/auth.js';
import { Network } from '/js/app/network.js';
import { UI } from '/js/features/ui/ui.js';
import { Editor } from '/js/features/editor/editor.js';
import { Theme } from '/js/features/theme/theme.js';
import { Profile } from '/js/features/profile/profile.js';
import { DynamicBackground } from '/js/features/theme/background.js';
import { navigateTo } from '/js/app/utils.js';
import { LibraryManager } from '/js/features/library/LibraryManager.js';
import { UIManager } from '/js/features/ui/UIManager.js';

export class App {
  constructor() {
    this.documentId = new URLSearchParams(window.location.search).get('doc');
    this.user = null;
    this.editor = null;
    this.theme = new Theme();
    this.profile = new Profile();
    this.background = new DynamicBackground();
    this.libraryManager = new LibraryManager(this);
    this.uiManager = new UIManager(this);
    this.connectionTimer = null;
    this.viewState = this.documentId ? 'editor-loading' : 'dashboard';
    this.openingDocumentId = null;
    this.openRequestToken = 0;
    this.openPromise = null;

    // Offline Indicator
    window.addEventListener('offline', () => this.showOfflineIndicator(true));
    window.addEventListener('online', () => this.showOfflineIndicator(false));

    // Handle browser back/forward buttons
    window.addEventListener('popstate', (event) => this.handlePopState(event));

    window.app = this; // Expose app instance
    this.init();
    this.registerServiceWorker();
  }

  showOfflineIndicator(isOffline) {
    const el = document.getElementById('offlineIndicator');
    if (el) {
      el.style.display = isOffline ? 'block' : 'none';
      if (!isOffline) {
        // Reconnect logic if needed
        if (this.editor && this.editor.reconnect && this.user) {
          this.editor.reconnect(this.user);
        }
      }
    }
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator && !navigator.webdriver) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            console.log('Service Worker registered');

            // Check for updates
            reg.onupdatefound = () => {
              const installingWorker = reg.installing;
              if (installingWorker) {
                installingWorker.onstatechange = () => {
                  if (
                    installingWorker.state === 'installed' &&
                    navigator.serviceWorker.controller
                  ) {
                    // New update available
                    console.log('New update available, skipping waiting...');
                    installingWorker.postMessage({ type: 'SKIP_WAITING' });
                  }
                };
              }
            };
          })
          .catch((err) => console.log('Service Worker registration failed:', err));
      });

      // Reload on controller change
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('Service Worker updated, refreshing...');
        window.location.reload();
      });
    }
  }

  async init() {
    // If we are on the login page, don't try to load the profile immediately.
    // The login page handles its own authentication flow.
    if (window.location.pathname.includes('login.html')) {
      return;
    }

    this.user = await this.profile.loadProfile({ silent: true });

    if (!this.user) {
      const params = new URLSearchParams(window.location.search).get('doc');
      navigateTo(params ? `pages/login.html?doc=${params}` : 'pages/login.html');
      return;
    }

    // Sync Theme from Profile
    if (this.user.accentColor) {
      this.theme.applyAccentColor(this.user.accentColor);
    }

    // Listen for Theme Changes to Sync Back
    window.addEventListener('theme-update', () => {
      if (this.user && this.theme.currentAccentColor) {
        if (this.user.accentColor !== this.theme.currentAccentColor) {
          this.profile.updateAccentColor(this.theme.currentAccentColor);
        }
      }
    });

    this.uiManager.setupEventListeners();
    this.uiManager.setupRibbonTabs();
    this.setupVisibilityListener();
    this.uiManager.applyViewState(this.viewState);

    if (this.documentId) {
      await this.openDocument(this.documentId, { pushHistory: false });
    } else {
      await this.libraryManager.showLibrary();
    }

    this.removeSplash();
  }

  removeSplash() {
    const splash = document.getElementById('cold-splash');
    if (splash) {
      // Anti-flicker delay (300ms)
      setTimeout(() => {
        splash.style.opacity = '0';
        splash.style.pointerEvents = 'none';
        // Remove from DOM after fade out (400ms transition)
        setTimeout(() => splash.remove(), 400);
      }, 300);
    }
  }

  setupVisibilityListener() {
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        console.log('Tab visible, checking session and connection...');

        // 1. Re-validate session (triggers refresh if needed)
        const user = await this.profile.loadProfile({ silent: true });
        if (!user) {
          Auth.logout();
          return;
        }

        // 2. Check connection
        if (this.editor && this.editor.provider) {
          if (!this.editor.provider.wsconnected) {
            console.log('WS disconnected on wake, forcing reconnection...');

            // Force reconnection with fresh ticket and updated user
            if (this.editor.reconnect) {
              this.editor.reconnect(user);
            }
          }
        }
      }
    });
  }

  handleWSStatusChange(status) {
    if (this.uiManager && this.uiManager.handleWSStatusChange) {
      this.uiManager.handleWSStatusChange(status);
    }
  }

  setViewState(state) {
    this.viewState = state;
    if (this.uiManager && this.uiManager.applyViewState) {
      this.uiManager.applyViewState(state);
    }
  }

  async ensureEditor(docId) {
    if (this.editor && this.editor.currentDocId !== docId) {
      this.editor.destroy();
      this.editor = null;
    }

    if (!this.editor) {
      this.editor = new Editor('pagesContainer', {
        user: this.user,
        docId,
        onPageChange: (index) => this.uiManager.updateStatus(index),
        onTitleChange: (title) => {
          try {
            const cache = localStorage.getItem('syncroedit_library_cache');
            if (cache) {
              const docs = JSON.parse(cache);
              const docIndex = docs.findIndex((d) => d._id === this.documentId);
              if (docIndex !== -1) {
                docs[docIndex].title = title;
                localStorage.setItem('syncroedit_library_cache', JSON.stringify(docs));
              }
            }
          } catch (e) {
            console.warn('Failed to update library cache title:', e);
          }
        },
        onStatusChange: (status) => this.uiManager.handleWSStatusChange(status),
        onCollaboratorsChange: (users) => {
          UI.updateCollaboratorsUI(
            document.getElementById('activeCollaborators'),
            users,
            this.user.username
          );
        },
      });
      console.log('[App] Editor created for docId=', docId);
    }

    return this.editor;
  }

  async openDocument(docId, options = {}) {
    if (!docId) return;
    if (this.openPromise && this.openingDocumentId === docId) {
      return this.openPromise;
    }

    const requestToken = ++this.openRequestToken;
    this.openingDocumentId = docId;
    this.documentId = docId;

    if (options.pushHistory !== false) {
      const nextUrl = `${window.location.pathname}?doc=${docId}`;
      if (window.location.search !== `?doc=${docId}`) {
        window.history.pushState({ view: 'editor', docId }, '', nextUrl);
      }
    }

    this.openPromise = (async () => {
      console.log('[App] openDocument docId=', docId);
      this.setViewState('opening-document');
      this.uiManager.setOpeningDocumentState(docId);
      this.uiManager.prepareEditorShellForLoading();
      this.uiManager.handleWSStatusChange('connecting');

      Network.addToRecent(docId).catch((err) => console.warn('Recent list update failed:', err));

      const snapshotPromise = Network.getDocumentSnapshot(docId);
      const editor = await this.ensureEditor(docId);

      if (requestToken !== this.openRequestToken) return;

      await this.uiManager.transitionToEditorShell();

      if (requestToken !== this.openRequestToken) return;

      this.setViewState('editor-loading');

      let hasCache = false;
      try {
        hasCache = await editor.loadFromCache(docId);
      } catch (err) {
        console.warn('[App] Cache load failed:', err);
      }

      if (requestToken !== this.openRequestToken) return;

      if (hasCache && editor.hasRenderableContent()) {
        this.setViewState('editor-ready');
        this.uiManager.showSkeleton(false);
        this.uiManager.focusEditorSurface({
          preferTitle: Boolean(options.focusTitle),
        });
        this.uiManager.handleWSStatusChange('syncing');
      }

      let snapshotApplied = false;
      try {
        const snapshot = await snapshotPromise;
        if (requestToken !== this.openRequestToken) return;
        snapshotApplied = await editor.applySnapshot(snapshot);
      } catch (err) {
        console.error('[App] Failed to load document snapshot:', err);
        if (!hasCache) {
          this.setViewState('editor-error');
          this.uiManager.showDocumentOpenError({
            message: 'Could not load this document.',
            onRetry: () => this.openDocument(docId, { ...options, pushHistory: false }),
          });
          return;
        }
      }

      if (requestToken !== this.openRequestToken) return;

      if (
        (snapshotApplied || hasCache || editor.hasRenderableContent()) &&
        this.viewState !== 'editor-error'
      ) {
        this.setViewState('editor-ready');
        this.uiManager.showSkeleton(false);
        this.uiManager.focusEditorSurface({
          preferTitle: Boolean(options.focusTitle),
        });
      }

      editor.connectWebSocket(docId, this.user).catch((err) => {
        console.error('[App] Realtime connection failed:', err);
      });
    })()
      .catch((err) => {
        console.error('[App] Failed to open document:', err);
        if (requestToken === this.openRequestToken) {
          this.setViewState('editor-error');
          this.uiManager.showDocumentOpenError({
            message: 'Could not load this document.',
            onRetry: () => this.openDocument(docId, { ...options, pushHistory: false }),
          });
        }
      })
      .finally(() => {
        if (requestToken === this.openRequestToken) {
          this.openingDocumentId = null;
          this.uiManager.clearOpeningDocumentState();
          this.uiManager.updateMobileUIState();
        }
      });

    return this.openPromise;
  }

  async loadDocument(options = {}) {
    return this.openDocument(this.documentId, options);
  }

  showTransitionOverlay(text = 'Loading...') {
    const authGuard = document.getElementById('authGuard');
    const authGuardText = document.getElementById('authGuardText');
    if (authGuard) {
      if (authGuardText) authGuardText.textContent = text;
      authGuard.style.display = 'flex';
      // Force reflow before showing to prevent flicker
      authGuard.offsetHeight;
      requestAnimationFrame(() => {
        authGuard.style.opacity = '1';
        authGuard.style.pointerEvents = 'auto';
      });
    }
  }

  hideTransitionOverlay() {
    const authGuard = document.getElementById('authGuard');
    if (authGuard) {
      authGuard.style.opacity = '0';
      authGuard.style.pointerEvents = 'none';
      setTimeout(() => (authGuard.style.display = 'none'), 300);
    }
  }

  handlePopState() {
    // Handle browser back/forward navigation
    const urlParams = new URLSearchParams(window.location.search);
    const docId = urlParams.get('doc');

    if (docId && docId !== this.documentId) {
      // Navigate to a different document
      this.documentId = docId;
      this.openDocument(docId, { pushHistory: false });
    } else if (!docId && this.documentId) {
      // Navigate to library from document
      this.documentId = null;
      this.libraryManager.showLibrary();
    }
  }
}

if (typeof window !== 'undefined' && !window.testEnv) {
  new App();
}
