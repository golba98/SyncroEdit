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

    if (this.documentId) {
      await this.loadDocument();
    } else {
      await this.libraryManager.showLibrary();
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

  async loadDocument() {
    const docId = this.documentId;
    if (!docId) return;

    const requestToken = ++this.loadDocumentToken;
    this.openingDocumentId = docId;
    console.log('[App] loadDocument docId=', docId);

    this.uiManager.applyViewState('opening-document');
    this.uiManager.setOpeningDocumentState();
    this.uiManager.handleWSStatusChange('connecting');

    const slowLoadTimer = setTimeout(() => {
      if (requestToken === this.loadDocumentToken && !this.hasLoadedEditorContent()) {
        this.uiManager.showSkeletonMessage(true);
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
          onPageChange: (index) => this.uiManager.updateStatus(index),
          onContentReady: () => this.finishDocumentOpen(requestToken),
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

      this.editor.onContentReady = () => this.finishDocumentOpen(requestToken);

      if (this.uiManager) {
        this.uiManager.updateMobileUIState();
      }

      if (this.editor.ready) {
        await this.editor.ready;
      }

      if (requestToken !== this.loadDocumentToken) return;

      if (this.hasLoadedEditorContent()) {
        this.finishDocumentOpen(requestToken);
      } else {
        this.uiManager.applyViewState('editor-loading');
        this.uiManager.showSkeletonMessage(true);
      }
    } catch (err) {
      console.error('[App] Failed to load document:', err);
      if (requestToken === this.loadDocumentToken) {
        this.uiManager.applyViewState('editor-error');
        this.uiManager.showDocumentOpenError({
          message: 'Could not load this document.',
          onRetry: () => this.loadDocument(),
        });
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
    if (this.editor?.yPages?.length > 0) return true;

    const pagesContainer = document.getElementById('pagesContainer');
    return Boolean(pagesContainer?.querySelector('.editor-container:not(.loading-placeholder)'));
  }

  finishDocumentOpen(requestToken) {
    if (requestToken !== this.loadDocumentToken || !this.hasLoadedEditorContent()) return;

    this.uiManager.applyViewState('editor-ready');
    this.uiManager.clearOpeningDocumentState();
    console.log('[App] Editor content ready for docId=', this.documentId);
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

  handlePopState(event) {
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
      this.libraryManager.showLibrary();
    }
  }
}

if (typeof window !== 'undefined' && !window.testEnv) {
  new App();
}
