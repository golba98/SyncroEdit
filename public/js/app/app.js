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
    this.loadDocumentToken = 0;
    this.openingDocumentId = null;
    this.documentLifecycleState = 'idle';
    this.documentLoadState = 'idle';
    this.connectionState = 'connecting';
    this.saveState = 'saved';
    this.hasReachedEditorReady = false;
    this.readyDocumentId = null;

    // Offline Indicator
    window.addEventListener('offline', () => this.showOfflineIndicator(true));
    window.addEventListener('online', () => this.showOfflineIndicator(false));

    // Handle browser back/forward buttons
    window.addEventListener('popstate', () => this.handlePopState());

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
    console.log('[BOOT] start');
    this.uiManager.applyViewState('booting');

    // If we are on the login page, don't try to load the profile immediately.
    // The login page handles its own authentication flow.
    if (window.location.pathname.includes('login.html')) {
      return;
    }

    console.log('[BOOT] auth resolving');
    this.user = await this.profile.loadProfile({ silent: true });

    if (!this.user) {
      console.log('[BOOT] failed');
      this.uiManager.applyViewState('auth');
      const params = new URLSearchParams(window.location.search).get('doc');
      navigateTo(params ? `pages/login.html?doc=${params}` : 'pages/login.html');
      return;
    }

    console.log('[BOOT] auth resolved');

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

    if (this.documentId) {
      console.log('[BOOT] route resolved document');
      await this.loadDocument();
    } else {
      console.log('[BOOT] route resolved dashboard');
      await this.libraryManager.showLibrary();
      console.log('[BOOT] dashboard ready');
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
    this.setConnectionState(status);
    if (this.uiManager && this.uiManager.handleWSStatusChange) {
      this.uiManager.handleWSStatusChange(status);
    }
  }

  setConnectionState(status) {
    const normalized = status === 'disconnected' ? 'reconnecting' : status;
    const knownStates = new Set(['connecting', 'connected', 'reconnecting', 'offline', 'failed']);
    this.connectionState = knownStates.has(normalized) ? normalized : 'connecting';
  }

  isEditorReadyForCurrentDocument() {
    return this.hasReachedEditorReady && this.readyDocumentId === this.documentId;
  }

  normalizeDocumentLoadState(state) {
    const stateMap = {
      idle: 'idle',
      opening: 'opening',
      'creating-document': 'opening',
      'loading-document': 'loading-content',
      connecting: 'initial-syncing',
      syncing: 'initial-syncing',
      ready: 'ready',
      error: 'failed',
      failed: 'failed',
    };
    return stateMap[state] || state;
  }

  setDocumentLifecycleState(state, options = {}) {
    const nextLoadState = this.normalizeDocumentLoadState(state);
    const isFullLoadingState = ['opening', 'loading-content', 'initial-syncing'].includes(
      nextLoadState
    );

    if (this.isEditorReadyForCurrentDocument() && isFullLoadingState) {
      console.log('[SYNC] blocked full loading because editor already ready', {
        requestedState: state,
        documentLoadState: this.documentLoadState,
        connectionState: this.connectionState,
      });
      console.log('[LOAD] full loading suppressed after ready', { requestedState: state });
      return;
    }

    this.documentLoadState = nextLoadState;
    this.documentLifecycleState = state;
    if (this.uiManager?.setDocumentOpenState) {
      this.uiManager.setDocumentOpenState(state, options);
    }
  }

  handleEditorLifecycleChange(state, detail, requestToken) {
    if (requestToken !== this.loadDocumentToken) return;

    this.setDocumentLifecycleState(state, detail || {});
    if (state === 'ready') this.finishDocumentOpen(requestToken);
    if (state === 'error') {
      this.showDocumentOpenError(requestToken, detail?.message || 'Could not load this document.');
    }
  }

  handleEditorStatusChange(status, docId) {
    const wasReady = this.isEditorReadyForCurrentDocument();
    this.handleWSStatusChange(status);

    if (wasReady) {
      if (status === 'connected') {
        console.log('[SYNC] reconnected after ready');
      } else if (status === 'reconnecting' || status === 'disconnected') {
        console.log('[SYNC] reconnecting after ready');
      } else if (status === 'offline') {
        console.log('[SYNC] connection lost after ready');
      }
      console.log('[SYNC] preserving editor view');
      return;
    }

    if (status === 'connected') {
      this.logLifecycle('websocket-connected', { docId });
      console.log('[OPEN] websocket connected');
      this.setDocumentLifecycleState('syncing');
    } else if (status === 'connecting') {
      this.setDocumentLifecycleState('connecting');
    } else if (status === 'reconnecting' || status === 'disconnected') {
      this.setDocumentLifecycleState('connecting', {
        title: 'Reconnecting...',
        description: 'Keeping local edits available while sync reconnects.',
      });
    }
  }

  setSaveState(status) {
    const normalized = status === 'offline' ? 'offline-saved' : status;
    const knownStates = new Set(['saved', 'saving', 'unsaved', 'offline-saved', 'failed']);
    this.saveState = knownStates.has(normalized) ? normalized : 'saved';
    this.uiManager.setSaveStatus(status);
  }

  logLifecycle(event, details = {}) {
    const debug = window.SYNCROEDIT_CONFIG?.DEBUG_LIFECYCLE;
    if (window.testEnv && !debug) return;
    if (!debug && window.location.hostname !== 'localhost') return;
    console.log('[Lifecycle]', event, details);
  }

  async loadDocument(options = {}) {
    console.log('[BOOT] opening document');
    const docId = this.documentId;
    if (!docId) return;

    const mode = options.mode || 'loading-document';
    const requestToken = ++this.loadDocumentToken;
    const isDifferentDocument =
      this.readyDocumentId !== docId || this.editor?.currentDocId !== docId;
    this.openingDocumentId = docId;
    if (isDifferentDocument) {
      this.hasReachedEditorReady = false;
      this.readyDocumentId = null;
    }
    this.logLifecycle('document-open-start', { docId, mode });

    if (!this.isEditorReadyForCurrentDocument()) {
      this.uiManager.applyViewState('opening-document');
      this.uiManager.setOpeningDocumentState();
      this.setDocumentLifecycleState(mode);
    } else {
      console.log('[LOAD] full loading suppressed after ready', { requestedState: mode });
    }
    this.uiManager.handleWSStatusChange('connecting');

    // Safety timeout to clear stuck opening states after 10 seconds
    if (this.openingSafetyTimeout) clearTimeout(this.openingSafetyTimeout);
    this.openingSafetyTimeout = setTimeout(() => {
      if (requestToken === this.loadDocumentToken && this.documentLifecycleState !== 'ready') {
        console.warn('[OPEN] Safety timeout triggered. Cleaning up opening states.');
        this.showDocumentOpenError(requestToken, 'Opening timed out. Please try again.');
      }
    }, 10000);

    const slowLoadTimer = setTimeout(() => {
      if (requestToken === this.loadDocumentToken && !this.hasLoadedEditorContent()) {
        this.uiManager.showSkeletonMessage(true, 'Still opening document...');
      }
    }, 2000);

    try {
      Network.addToRecent(docId).catch((err) => console.warn('Recent list update failed:', err));

      // Destroy and recreate editor when switching to a different document
      if (this.editor && this.editor.currentDocId !== docId) {
        this.editor.destroy();
        this.editor = null;
      }

      if (!this.editor) {
        this.editor = new Editor('pagesContainer', {
          user: this.user,
          isNewDocument: Boolean(options.isNewDocument),
          onPageChange: (index) => this.uiManager.updateStatus(index),
          onContentReady: () => this.finishDocumentOpen(requestToken),
          onLifecycleChange: (state, detail) =>
            this.handleEditorLifecycleChange(state, detail, requestToken),
          onSaveStatusChange: (status) => this.setSaveState(status),
          onTitleChange: (title) => {
            try {
              const cache = localStorage.getItem('syncroedit_library_cache');
              if (cache) {
                const docs = JSON.parse(cache);
                const docIndex = docs.findIndex((d) => d._id === docId);
                if (docIndex !== -1) {
                  docs[docIndex].title = title;
                  localStorage.setItem('syncroedit_library_cache', JSON.stringify(docs));
                }
              }
            } catch (e) {
              console.warn('Failed to update library cache title:', e);
            }
          },
          onStatusChange: (status) => this.handleEditorStatusChange(status, docId),
          onCollaboratorsChange: (users) => {
            UI.updateCollaboratorsUI(
              document.getElementById('activeCollaborators'),
              users,
              this.user.username
            );
          },
        });
        this.logLifecycle('editor-created', { docId });
      }

      this.editor.onContentReady = () => this.finishDocumentOpen(requestToken);
      this.editor.onLifecycleChange = (state, detail) =>
        this.handleEditorLifecycleChange(state, detail, requestToken);
      this.editor.onSaveStatusChange = (status) => this.setSaveState(status);

      if (this.uiManager) {
        this.uiManager.updateMobileUIState();
      }

      if (this.editor.ready) {
        await this.editor.ready;
      }

      if (requestToken !== this.loadDocumentToken) return;

      console.log('[OPEN] document loaded');

      if (
        this.editor?.isReadyForUser ? this.editor.isReadyForUser() : this.hasLoadedEditorContent()
      ) {
        this.finishDocumentOpen(requestToken);
      } else {
        this.uiManager.applyViewState('editor-loading');
        this.uiManager.showSkeletonMessage(true);
      }
    } catch (err) {
      console.error('[App] Failed to load document:', err);
      console.log('[OPEN] failed');
      if (requestToken === this.loadDocumentToken) {
        this.showDocumentOpenError(requestToken, 'Could not load this document.');
      }
    } finally {
      clearTimeout(slowLoadTimer);
      if (requestToken === this.loadDocumentToken) {
        this.openingDocumentId = null;
        this.uiManager.updateMobileUIState();
      }
    }
  }

  hasLoadedEditorContent() {
    if (this.editor?.hasLoadedDocumentContent?.()) return true;
    if (this.editor?.yPages?.length > 0) return true;

    const pagesContainer = document.getElementById('pagesContainer');
    return Boolean(pagesContainer?.querySelector('.editor-container:not(.loading-placeholder)'));
  }

  finishDocumentOpen(requestToken) {
    if (requestToken !== this.loadDocumentToken) return;
    if (this.editor?.isReadyForUser && !this.editor.isReadyForUser()) return;
    if (!this.editor?.isReadyForUser && !this.hasLoadedEditorContent()) return;

    if (this.openingSafetyTimeout) {
      clearTimeout(this.openingSafetyTimeout);
      this.openingSafetyTimeout = null;
    }

    this.uiManager.applyViewState('editor-ready');
    this.uiManager.clearOpeningDocumentState();
    this.hasReachedEditorReady = true;
    this.readyDocumentId = this.documentId;
    this.documentLoadState = 'ready';
    this.documentLifecycleState = 'ready';
    this.setSaveState('saved');
    this.libraryManager.clearOpeningStates();
    console.log('[BOOT] editor ready');
    console.log('[OPEN] editor ready');
    console.log('[OPEN] transition cleanup');
    this.logLifecycle('editor-ready', { docId: this.documentId });
  }

  showDocumentOpenError(requestToken, message) {
    if (requestToken !== this.loadDocumentToken) return;

    if (this.openingSafetyTimeout) {
      clearTimeout(this.openingSafetyTimeout);
      this.openingSafetyTimeout = null;
    }

    this.uiManager.applyViewState('editor-error');
    this.setDocumentLifecycleState('error', { description: message });
    this.libraryManager.clearOpeningStates();
    console.log('[OPEN] failed');
    this.uiManager.showDocumentOpenError({
      message,
      onRetry: () => this.loadDocument(),
      onBack: () => {
        this.loadDocumentToken++;
        if (this.editor) {
          this.editor.destroy();
          this.editor = null;
        }
        this.documentId = null;
        this.hasReachedEditorReady = false;
        this.readyDocumentId = null;
        this.documentLoadState = 'idle';
        window.history.pushState({ view: 'library' }, '', window.location.pathname);
        this.libraryManager.showLibrary();
      },
    });
    this.logLifecycle('open-failed', { docId: this.documentId, message });
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
      this.loadDocument();
    } else if (!docId && this.documentId) {
      // Navigate to library from document
      this.documentId = null;
      this.hasReachedEditorReady = false;
      this.readyDocumentId = null;
      this.documentLoadState = 'idle';
      this.libraryManager.showLibrary();
    }
  }
}

if (typeof window !== 'undefined' && !window.testEnv) {
  new App();
}
