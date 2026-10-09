import { Auth } from '/js/features/auth/auth.js';
import { Network } from '/js/app/network.js';
import { escapeHTML } from '/js/app/utils.js';
import { ResponsiveLayoutController } from '/js/features/ui/ResponsiveLayoutController.js';

export class UIManager {
  constructor(app) {
    this.app = app;
    this.saveStatusTimer = null;
    this.isMobileEditing = false;
    this.documentOpenState = 'idle';
    this.hasShownEditorReady = false;
    this.responsiveLayout = new ResponsiveLayoutController(app);

    // Bind and expose workspace loader helpers globally
    this.showEditorWorkspaceLoader = this.showEditorWorkspaceLoader.bind(this);
    this.hideEditorWorkspaceLoader = this.hideEditorWorkspaceLoader.bind(this);
    this.revealPagesContainer = this.revealPagesContainer.bind(this);
    this.preventBlackEditorLoadingState = this.preventBlackEditorLoadingState.bind(this);

    window.showEditorWorkspaceLoader = this.showEditorWorkspaceLoader;
    window.hideEditorWorkspaceLoader = this.hideEditorWorkspaceLoader;
    window.revealPagesContainer = this.revealPagesContainer;
    window.preventBlackEditorLoadingState = this.preventBlackEditorLoadingState;
    this.responsiveLayout.init();
  }

  setupEventListeners() {
    this.setupMobileEvents();
    const addEvent = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    };

    // Navigation/Library
    addEvent('menuBtn', 'click', () => {
      this.app.libraryManager.showLibrary();
    });
    addEvent('createNewDoc', 'click', () => this.app.libraryManager.createNewDocument());
    addEvent('editorBrand', 'click', () => this.app.libraryManager.showLibrary());
    addEvent('closeLibrary', 'click', () => {
      if (this.app.documentId) {
        const docLibrary = document.getElementById('docLibrary');
        const libraryOverlay = document.getElementById('libraryOverlay');

        // Smooth transition out
        if (docLibrary) docLibrary.classList.remove('view-visible');
        if (libraryOverlay) libraryOverlay.classList.remove('view-visible');

        setTimeout(() => {
          if (docLibrary) docLibrary.style.display = 'none';
          if (libraryOverlay) libraryOverlay.style.display = 'none';
          this.updateMobileUIState();
        }, 200);
      }
    });

    // Profile
    addEvent('userProfileTrigger', 'click', () => {
      const modal = document.getElementById('profileModal');
      if (modal) modal.style.display = 'flex';
    });
    addEvent('libraryUserProfileTrigger', 'click', () => {
      const modal = document.getElementById('profileModal');
      if (modal) modal.style.display = 'flex';
    });
    addEvent('headerProfileMenuBtn', 'click', () => {
      const modal = document.getElementById('profileModal');
      if (modal) modal.style.display = 'flex';
    });
    addEvent('closeProfileModal', 'click', () => {
      const modal = document.getElementById('profileModal');
      if (modal) modal.style.display = 'none';
    });
    addEvent('logoutBtnProfile', 'click', () => Auth.logout());

    // Profile Tabs
    const profileTabs = document.querySelectorAll('.profile-tab');
    const profileTabContents = document.querySelectorAll('.profile-tab-content');
    profileTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        profileTabs.forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        profileTabContents.forEach((c) => (c.style.display = 'none'));
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        const targetContent = document.getElementById(`${targetTab}-content`);
        if (targetContent) targetContent.style.display = 'block';

        // Load sessions if security tab opened
        if (targetTab === 'security') {
          this.app.profile.loadSessions();
        }
      });
    });

    // Bio Update
    addEvent('saveGeneralBtn', 'click', () => {
      const bio = document.getElementById('profileBioInput')?.value;
      this.app.profile.updateBio(bio);
    });

    // Password Update
    addEvent('updatePasswordBtn', 'click', async () => {
      const next = document.getElementById('newPassword')?.value;
      if (next) {
        if (next.length < 8) {
          alert('New password must be at least 8 characters long.');
          return;
        }

        const current = await this.app.profile.promptIdentityConfirmation();
        if (current) {
          const success = await this.app.profile.updatePassword(current, next);
          if (success) {
            document.getElementById('newPassword').value = '';
            // Reset strength bar
            const bar = document.getElementById('passwordStrengthBar');
            if (bar) bar.style.width = '0%';
          }
        }
      }
    });

    // Theme
    addEvent('darkThemeBtn', 'click', () => this.app.theme.applyTheme('dark'));
    addEvent('lightThemeBtn', 'click', () => this.app.theme.applyTheme('light'));

    // Accent Colors
    document.querySelectorAll('.accent-color-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.app.theme.applyAccentColor(btn.dataset.color));
    });

    // History
    addEvent('showHistoryBtn', 'click', () => this.app.showHistory());
    addEvent('closeHistoryModal', 'click', () => {
      const modal = document.getElementById('historyModal');
      if (modal) modal.style.display = 'none';
    });

    // Save and Save As
    addEvent('saveAsBtn', 'click', async () => {
      alert('Save As is currently disabled during migration to Real-time engine.');
      // Needs to be re-implemented to copy Yjs state
    });

    // Share
    addEvent('shareBtn', 'click', async () => {
      const modal = document.getElementById('shareModal');
      const input = document.getElementById('shareLink');
      const toggle = document.getElementById('linkSharingToggle');
      const shareLinkContainer = document.getElementById('shareLinkContainer');

      if (modal && input) {
        input.value = window.location.href;

        // Load current settings
        if (toggle && this.app.documentId) {
          toggle.disabled = true;
          toggle.parentElement.style.opacity = '0.5';

          try {
            const settings = await Network.getDocumentSettings(this.app.documentId);
            toggle.checked = settings.isPublic;

            // Update link visual state
            if (shareLinkContainer) {
              shareLinkContainer.style.opacity = settings.isPublic ? '1' : '0.5';
              shareLinkContainer.style.pointerEvents = settings.isPublic ? 'all' : 'none';
            }

            // Only owner can change settings
            if (!settings.isOwner) {
              toggle.disabled = true;
              toggle.title = 'Only the document owner can change sharing settings.';
            } else {
              toggle.disabled = false;
              toggle.parentElement.style.opacity = '1';
            }
          } catch (err) {
            console.error('Failed to load settings', err);
          }
        }

        modal.style.display = 'flex';
      }
    });
    addEvent('shareRibbonBtn', 'click', () => document.getElementById('shareBtn')?.click());

    addEvent('linkSharingToggle', 'change', async (e) => {
      const enabled = e.target.checked;
      const status = document.getElementById('linkSharingStatus');
      const shareLinkContainer = document.getElementById('shareLinkContainer');

      if (status) {
        status.style.display = 'block';
        status.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
      }

      try {
        await Network.updateDocumentSettings(this.app.documentId, {
          isPublic: enabled,
        });

        // Update link visual state
        if (shareLinkContainer) {
          shareLinkContainer.style.opacity = enabled ? '1' : '0.5';
          shareLinkContainer.style.pointerEvents = enabled ? 'all' : 'none';
        }

        if (status) {
          status.innerHTML = '<i class="fas fa-check"></i> Updated successfully';
          status.style.color = '#10b981';
          setTimeout(() => (status.style.display = 'none'), 2000);
        }
      } catch (err) {
        console.error('Failed to update settings', err);
        e.target.checked = !enabled; // Revert
        if (status) {
          status.innerHTML = '<i class="fas fa-times"></i> Failed to update';
          status.style.color = '#ef4444';
        }
      }
    });

    addEvent('closeShareModal', 'click', () => {
      const modal = document.getElementById('shareModal');
      if (modal) modal.style.display = 'none';
    });

    addEvent('copyLinkBtn', 'click', () => {
      const input = document.getElementById('shareLink');
      input.select();
      document.execCommand('copy');
      const btn = document.getElementById('copyLinkBtn');
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
      setTimeout(() => (btn.innerHTML = original), 2000);
    });

    // Page Size
    addEvent('pageSizeSelect', 'change', (e) => {
      if (this.app.editor) {
        this.app.editor.setPageSize(e.target.value);
      }
    });

    // New Page
    addEvent('newPageBtn', 'click', () => {
      if (this.app.editor) {
        const newIndex = this.app.editor.yPages.length;
        this.app.editor.addNewPage();
        setTimeout(() => this.app.editor.switchToPage(newIndex, 'start'), 50);
      }
    });
  }

  setupMobileEvents() {
    // FAB Logic
    const fabCreate = document.getElementById('fabCreateDoc');
    const fabEdit = document.getElementById('fabEditDoc');

    if (fabCreate) {
      fabCreate.addEventListener('click', () => {
        this.app.libraryManager.createNewDocument();
      });
    }

    if (fabEdit) {
      fabEdit.addEventListener('click', () => {
        if (this.app.editor && this.app.editor.quill) {
          this.app.editor.quill.focus();
          this.setMobileEditMode(true);
        }
      });
    }

    // Bottom Nav
    const navItems = document.querySelectorAll('.bottom-nav-item');
    navItems.forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        navItems.forEach((i) => i.classList.remove('active'));
        item.classList.add('active');

        if (item.id === 'navHome') {
          this.app.libraryManager.showLibrary();
        } else if (item.id === 'navProfile') {
          const modal = document.getElementById('profileModal');
          if (modal) modal.style.display = 'flex';
        }
        // navShared is placeholder for now
      });
    });

    // Mobile Toolbar Close Keyboard
    const closeKbd = document.getElementById('mobileCloseKeyboard');
    if (closeKbd) {
      closeKbd.addEventListener('click', () => {
        if (this.app.editor && this.app.editor.quill) {
          this.app.editor.quill.blur();
          this.setMobileEditMode(false);
        }
      });
    }

    const moreTools = document.getElementById('mobileMoreTools');
    const moreToolsBtn = document.getElementById('mobileMoreToolsBtn');
    if (moreTools && moreToolsBtn) {
      moreToolsBtn.addEventListener('click', () => {
        const open = moreTools.hidden;
        moreTools.hidden = !open;
        moreToolsBtn.setAttribute('aria-expanded', String(open));
      });
    }

    // Initial state
    this.updateMobileUIState();

    // Listen for editor focus/blur to toggle toolbar
    document.addEventListener('focusin', (e) => {
      if (window.innerWidth <= 768 && e.target.closest('.ql-editor')) {
        this.setMobileEditMode(true);
      }
    });

    // We don't blur immediately on focusout because clicking a toolbar button might trigger focusout
    // Instead, we rely on the Close Keyboard button or manual blur
  }

  updateMobileUIState() {
    const isMobile = window.innerWidth <= 768;

    const fabCreate = document.getElementById('fabCreateDoc');
    const fabEdit = document.getElementById('fabEditDoc');
    const bottomNav = document.querySelector('.bottom-nav');
    const docLibrary = document.getElementById('docLibrary');

    const isLibraryVisible = docLibrary && docLibrary.style.display !== 'none';
    const hasDocument = !!this.app.documentId;

    if (!isMobile) {
      if (fabCreate) fabCreate.style.removeProperty('display');
      if (fabEdit) fabEdit.style.removeProperty('display');
      if (bottomNav) bottomNav.style.removeProperty('display');
    } else if (isLibraryVisible) {
      if (fabCreate) fabCreate.style.display = 'flex';
      if (fabEdit) fabEdit.style.display = 'none';
      if (bottomNav) bottomNav.style.display = 'flex';
    } else if (hasDocument) {
      if (fabCreate) fabCreate.style.display = 'none';
      // The edit button is only for getting into edit mode; the toolbar replaces it while editing.
      if (fabEdit) fabEdit.style.display = this.isMobileEditing ? 'none' : 'flex';
      if (bottomNav) bottomNav.style.display = 'none';
    }
  }

  applyViewState(state) {
    document.body.dataset.viewState = state;

    const bootLoader = document.getElementById('bootLoader');
    if (bootLoader) {
      if (state === 'booting') {
        bootLoader.classList.remove('fading-out');
        bootLoader.style.display = 'flex';
      } else if (
        bootLoader.style.display !== 'none' &&
        !bootLoader.classList.contains('fading-out')
      ) {
        bootLoader.classList.add('fading-out');
        const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0 : 200;
        if (duration === 0) {
          bootLoader.style.display = 'none';
        } else {
          setTimeout(() => {
            if (document.body.dataset.viewState !== 'booting') {
              bootLoader.style.display = 'none';
            }
          }, duration);
        }
      }
    }

    const library = document.getElementById('docLibrary');
    const overlay = document.getElementById('libraryOverlay');
    const closeBtn = document.getElementById('closeLibrary');
    const showDashboard = state === 'dashboard';
    const keepDashboardMounted = showDashboard;

    if (library) {
      library.style.display = keepDashboardMounted ? 'block' : 'none';
      library.classList.toggle('view-visible', showDashboard);
    }

    if (overlay) {
      overlay.style.display = keepDashboardMounted ? 'block' : 'none';
      overlay.classList.toggle('view-visible', showDashboard);
    }

    if (closeBtn) {
      closeBtn.style.display = showDashboard && this.app.documentId ? 'block' : 'none';
    }

    // Editor elements soft-reveal transitions
    const header = document.querySelector('.header');
    const ribbonTabs = document.querySelector('.ribbon-tabs');
    const ribbonContent = document.querySelector('.ribbon-content');
    const statusBar = document.querySelector('.status-bar');
    const softRevealEls = [header, ribbonTabs, ribbonContent, statusBar].filter(Boolean);

    if (state === 'opening-document') {
      this.assertNoBlankOpeningState();
      softRevealEls.forEach((el) => {
        el.classList.add('soft-reveal-enter');
        el.classList.remove('soft-reveal-ready');
      });
    } else if (state === 'editor-loading' || state === 'editor-ready') {
      this.hideDocumentOpeningLoader();
      requestAnimationFrame(() => {
        softRevealEls.forEach((el) => {
          el.classList.remove('soft-reveal-enter');
          el.classList.add('soft-reveal-ready');
        });
      });
    } else if (state === 'booting' || state === 'auth' || state === 'dashboard') {
      this.hideDocumentOpeningLoader();
      softRevealEls.forEach((el) => {
        el.classList.remove('soft-reveal-enter', 'soft-reveal-ready');
      });
    } else if (state === 'editor-error') {
      this.hideDocumentOpeningLoader();
    }
    this.preventBlackEditorLoadingState();
  }

  showDocumentOpeningLoader(text = 'Opening document...') {
    const loader = document.getElementById('documentOpeningLoader');
    const title = document.getElementById('documentOpeningTitle');
    if (loader) {
      if (title) title.textContent = text;
      loader.hidden = true;
    }
  }

  hideDocumentOpeningLoader() {
    const loader = document.getElementById('documentOpeningLoader');
    if (loader) loader.hidden = true;
  }

  assertNoBlankOpeningState() {
    const isOpening = document.body.dataset.viewState === 'opening-document';
    const loader = document.getElementById('documentOpeningLoader');
    const loaderVisible = loader && !loader.hidden;

    if (isOpening && loaderVisible) {
      loader.hidden = true;
    }
  }

  showEditorWorkspaceLoader(message = 'Opening document...') {
    const loader = document.getElementById('editorWorkspaceLoader');
    if (!loader) return;

    // Must remove the HTML `hidden` attribute — browsers apply
    // [hidden] { display: none !important } in their UA stylesheet which
    // takes precedence over any CSS class-based or body-state display rule.
    // Setting loader.hidden = false alone only clears the IDL property but
    // does NOT remove the content attribute in all browser implementations.
    loader.removeAttribute('hidden');
    loader.hidden = false;
    const titleEl = loader.querySelector('.loader-title');
    if (titleEl) titleEl.textContent = message;

    document.querySelector('.main-workspace')?.classList.add('is-document-opening');
  }

  hideEditorWorkspaceLoader() {
    // Guard: never hide the workspace loader before the editor is confirmed
    // ready. Premature hiding is the primary cause of the black workspace
    // screen because the pages container is still opacity:0 at that point.
    if (document.body.dataset.editorReady !== 'true') {
      console.warn(
        '[LOADER] Blocked hideEditorWorkspaceLoader — editor not ready yet (editorReady =',
        document.body.dataset.editorReady + ')'
      );
      return;
    }
    const loader = document.getElementById('editorWorkspaceLoader');
    if (loader) loader.hidden = true;

    document.querySelector('.main-workspace')?.classList.remove('is-document-opening');
  }

  revealPagesContainer() {
    const pagesContainer = document.getElementById('pagesContainer');
    if (pagesContainer) {
      pagesContainer.hidden = false;
      pagesContainer.style.opacity = '';
      pagesContainer.style.transform = '';
    }
  }

  preventBlackEditorLoadingState() {
    const mainWorkspace = document.querySelector('.main-workspace');
    const pagesContainer = document.getElementById('pagesContainer');
    const loader = document.getElementById('editorWorkspaceLoader');

    const editorVisible = mainWorkspace && getComputedStyle(mainWorkspace).display !== 'none';
    const pagesHidden =
      !pagesContainer ||
      pagesContainer.hidden ||
      getComputedStyle(pagesContainer).display === 'none' ||
      getComputedStyle(pagesContainer).opacity === '0';

    const editorReady = document.body.dataset.editorReady === 'true';

    if (editorVisible && pagesHidden && !editorReady && (loader ? loader.hidden : true)) {
      console.warn('[OPEN] Prevented black editor workspace: showing loader');
      const isCreating = this.app?.documentLoadState === 'creating';
      this.showEditorWorkspaceLoader(isCreating ? 'Creating document...' : 'Opening document...');
    }
  }

  setOpeningDocumentState() {
    if (this.hasShownEditorReady && this.app?.isEditorReadyForCurrentDocument?.()) {
      return;
    }

    this.showSkeleton(true);
    this.showSkeletonMessage(false);
    this.setDocumentOpenState(this.app?.documentLoadState || 'loading-content');

    const error = document.getElementById('editorOpenError');
    if (error) error.hidden = true;

    this.preventBlackEditorLoadingState();
  }

  clearOpeningDocumentState() {
    this.showSkeletonMessage(false);
    this.showSkeleton(false);
    this.hasShownEditorReady = true;

    document.body.dataset.documentState = 'ready';
    document.body.dataset.editorReady = 'true';
    this.hideEditorWorkspaceLoader();
    this.revealPagesContainer();

    this.setDocumentOpenState('ready');

    this.preventBlackEditorLoadingState();
  }

  showSkeleton(visible) {
    const skeleton = document.getElementById('editorSkeleton');
    if (!skeleton) return;

    skeleton.classList.toggle('hidden', !visible);
    if (!visible) {
      skeleton.classList.remove('has-error');
      this.showSkeletonMessage(false);
      const error = document.getElementById('editorOpenError');
      if (error) error.hidden = true;
    }
  }

  showSkeletonMessage(visible, message = 'Still loading document...') {
    const messageEl = document.getElementById('editorSkeletonMessage');
    if (!messageEl) return;

    messageEl.textContent = message;
    messageEl.hidden = !visible;
  }

  setDocumentOpenState(state, options = {}) {
    const normalizedStateMap = {
      idle: 'idle',
      opening: 'opening',
      creating: 'creating',
      'creating-document': 'creating',
      'loading-document': 'loading-content',
      'loading-content': 'loading-content',
      connecting: 'initial-syncing',
      syncing: 'initial-syncing',
      'initial-syncing': 'initial-syncing',
      ready: 'ready',
      error: 'failed',
      failed: 'failed',
    };
    const normalizedState = normalizedStateMap[state] || state;
    const loadingStates = new Set([
      'idle',
      'opening',
      'creating',
      'loading-content',
      'initial-syncing',
    ]);
    if (
      this.documentOpenState === 'ready' &&
      this.hasShownEditorReady &&
      loadingStates.has(normalizedState) &&
      this.app?.isEditorReadyForCurrentDocument?.()
    ) {
      return;
    }

    this.documentOpenState = normalizedState;
    document.body.dataset.documentOpenState = normalizedState;

    if (loadingStates.has(normalizedState)) {
      document.body.dataset.editorReady = 'false';
      if (normalizedState === 'idle') {
        document.body.dataset.documentState = 'opening';
      } else {
        document.body.dataset.documentState = normalizedState;
      }
    } else if (normalizedState === 'ready') {
      document.body.dataset.documentState = 'ready';
      document.body.dataset.editorReady = 'true';
    } else {
      document.body.dataset.documentState = normalizedState;
      document.body.dataset.editorReady = 'false';
    }

    const skeleton = document.getElementById('editorSkeleton');
    const statusEl = document.getElementById('editorSkeletonStatus');
    const titleEl = document.getElementById('editorSkeletonTitle');
    const descEl = document.getElementById('editorSkeletonDescription');

    // Keep one title for the whole open flow instead of narrating each internal step.
    const openTitle = this.app?.isNewBlankDocument ? 'Creating document...' : 'Opening document...';
    const copy = {
      idle: ['Opening document...', 'Getting your workspace ready.'],
      opening: ['Opening document...', 'Preparing your workspace.'],
      creating: ['Creating document...', 'Setting up a blank page.'],
      'loading-content': [openTitle, 'Loading document content.'],
      'initial-syncing': [openTitle, 'Loading document content.'],
      ready: ['Saved', 'Your document is ready.'],
      failed: ['Could not open document', 'Try again or return to the dashboard.'],
    };

    const [title, description] = copy[normalizedState] || copy.idle;
    if (statusEl) statusEl.textContent = options.status || title;
    if (titleEl) titleEl.textContent = options.title || title;
    if (descEl) descEl.textContent = options.description || description;

    if (loadingStates.has(normalizedState)) {
      this.showEditorWorkspaceLoader(options.status || title);
    } else {
      this.hideEditorWorkspaceLoader();
    }

    if (skeleton) {
      skeleton.dataset.openState = normalizedState;
      if (normalizedState !== 'ready') this.showSkeleton(true);
    }

    this.preventBlackEditorLoadingState();
  }

  showDocumentOpenError({ message, onRetry, onBack }) {
    this.showSkeleton(true);
    this.showSkeletonMessage(false);
    this.setDocumentOpenState('failed', {
      title: 'Could not open document',
      description: message,
    });

    const skeleton = document.getElementById('editorSkeleton');
    const error = document.getElementById('editorOpenError');
    const errorMessage = document.getElementById('editorOpenErrorMessage');
    const retryBtn = document.getElementById('editorOpenRetry');
    const backBtn = document.getElementById('editorOpenBack');

    if (skeleton) skeleton.classList.add('has-error');
    if (errorMessage) errorMessage.textContent = message;
    if (retryBtn) retryBtn.onclick = onRetry;
    if (backBtn) backBtn.onclick = onBack;
    if (error) error.hidden = false;
  }

  setMobileEditMode(active) {
    this.isMobileEditing = active;
    const toolbar = document.getElementById('mobileContextualToolbar');
    const fabEdit = document.getElementById('fabEditDoc');
    const header = document.querySelector('.header');

    if (active) {
      if (toolbar) toolbar.style.display = 'block';
      if (fabEdit) fabEdit.style.display = 'none';
      if (header) header.classList.add('is-mobile-editing');
    } else {
      if (toolbar) toolbar.style.display = 'none';
      if (fabEdit) fabEdit.style.display = 'flex';
      if (header) header.classList.remove('is-mobile-editing');
    }
  }

  setupRibbonTabs() {
    const tabs = document.querySelectorAll('.ribbon-tab');
    const ribbons = document.querySelectorAll('.ribbon-content');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        ribbons.forEach((r) => r.classList.remove('active'));
        tab.classList.add('active');
        const ribbon = document.getElementById(`${tab.dataset.tab}-ribbon`);
        if (ribbon) ribbon.classList.add('active');
      });
    });
  }

  async showHistory() {
    if (!this.app.documentId) return;
    const modal = document.getElementById('historyModal');
    const list = document.getElementById('historyList');
    if (!modal || !list) return;

    modal.style.display = 'flex';
    list.innerHTML = 'Loading history...';

    try {
      const history = await Network.getHistory(this.app.documentId);
      list.innerHTML = history
        .map((item) => {
          const username = escapeHTML(item.username || 'Unknown');
          const action = escapeHTML(item.action || '');
          const details = escapeHTML(item.details || '');
          return `
                <div style="padding: 10px; border-bottom: 1px solid #2a2a2a;">
                    <div style="display: flex; justify-content: space-between;">
                        <strong>${username}</strong>
                        <small>${new Date(item.timestamp).toLocaleString()}</small>
                    </div>
                    <div>${action}</div>
                    ${details ? `<div style="font-size: 11px; color: #666;">${details}</div>` : ''}
                </div>
            `;
        })
        .join('');
    } catch {
      list.innerHTML = 'Failed to load history';
    }
  }

  updateStatus(pageIndex) {
    this.updatePageIndicator(pageIndex);
  }

  updatePageIndicator(pageIndex) {
    const pageIndicator = document.getElementById('pageIndicator');
    if (!pageIndicator) return;

    const idx =
      typeof pageIndex === 'number'
        ? pageIndex
        : this.app.editor
          ? this.app.editor.currentPageIndex
          : 0;
    const totalPages = this.app.editor ? this.app.editor.yPages.length : 1;
    pageIndicator.textContent = `Page ${idx + 1} of ${Math.max(1, totalPages)}`;
  }

  updateStats(stats) {
    const wordEl = document.getElementById('wordCount');
    const charEl = document.getElementById('charCount');
    if (!wordEl || !charEl) return;

    const words = stats.wordCount;
    const chars = stats.charCount;

    wordEl.dataset.count = words;
    charEl.dataset.count = chars;

    const wordLabel = wordEl.querySelector('.status-label');
    if (wordLabel) {
      wordLabel.textContent = words === 1 ? '1 word' : `${words} words`;
    } else {
      wordEl.textContent = words === 1 ? '1 word' : `${words} words`;
    }

    const charLabel = charEl.querySelector('.status-label');
    if (charLabel) {
      charLabel.textContent = chars === 1 ? '1 character' : `${chars} characters`;
    } else {
      charEl.textContent = chars === 1 ? '1 character' : `${chars} characters`;
    }

    this.updatePageIndicator();
  }

  updateSelectionStats(stats) {
    const container = document.getElementById('selectionStatsContainer');
    const statsEl = document.getElementById('selectionStats');
    if (!container || !statsEl) return;

    if (stats && stats.hasSelection && stats.charCount > 0) {
      const wordsLabel = stats.wordCount === 1 ? '1 word' : `${stats.wordCount} words`;
      const charsLabel = stats.charCount === 1 ? '1 character' : `${stats.charCount} characters`;
      statsEl.textContent = `Selected: ${wordsLabel} · ${charsLabel}`;
      container.style.display = 'inline-flex';
    } else {
      container.style.display = 'none';
    }
  }

  handleWSStatusChange() {
    // Connection state is not surfaced to the user; the save indicator covers it.
    const overlay = document.getElementById('serverOfflineOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  setSaveStatus(status) {
    const indicator = document.getElementById('saveStatusIndicator');
    if (!indicator) return;

    if (this.saveStatusTimer) {
      clearTimeout(this.saveStatusTimer);
      this.saveStatusTimer = null;
    }

    const stateMap = {
      saved: 'Saved',
      saving: 'Saving…',
      unsaved: 'Unsaved changes',
      offline: 'Offline',
      failed: 'Save failed',
    };

    indicator.textContent = stateMap[status] || stateMap.saved;
    indicator.dataset.status = status;
    indicator.hidden = false;
  }

  openProfileModal() {
    const modal = document.getElementById('profileModal');
    if (modal) {
      modal.style.display = 'flex';
      const generalTab = document.getElementById('tab-general');
      if (generalTab) {
        generalTab.click();
      }
    }
  }

  cleanupTimers() {
    if (this.saveStatusTimer) clearTimeout(this.saveStatusTimer);
    this.saveStatusTimer = null;
  }
}
