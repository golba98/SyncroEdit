import { Auth } from '/js/features/auth/auth.js';
import { Network } from '/js/app/network.js';
import { escapeHTML } from '/js/app/utils.js';
import { UI } from '/js/features/ui/ui.js';

export class UIManager {
  constructor(app) {
    this.app = app;
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
        profileTabs.forEach((t) => t.classList.remove('active'));
        profileTabContents.forEach((c) => (c.style.display = 'none'));
        tab.classList.add('active');
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
    addEvent('saveBtn', 'click', () => {
      const saveBtn = document.getElementById('saveBtn');
      const originalText = saveBtn.innerHTML;
      saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved';
      saveBtn.style.background = '#10b981';

      // Yjs autosaves, so this is just visual feedback
      // We could force a save via API if we wanted to be sure

      setTimeout(() => {
        saveBtn.innerHTML = originalText;
        saveBtn.style.background = '';
      }, 2000);
    });

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
    const isMobile = window.innerWidth <= 768;

    // FAB Logic
    const fabCreate = document.getElementById('fabCreateDoc');
    const fabEdit = document.getElementById('fabEditDoc');
    const mobileToolbar = document.getElementById('mobileContextualToolbar');

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

    // Initial state
    this.updateMobileUIState();

    // Listen for editor focus/blur to toggle toolbar
    document.addEventListener('focusin', (e) => {
      if (isMobile && e.target.closest('.ql-editor')) {
        this.setMobileEditMode(true);
      }
    });

    // We don't blur immediately on focusout because clicking a toolbar button might trigger focusout
    // Instead, we rely on the Close Keyboard button or manual blur
  }

  updateMobileUIState() {
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return;

    const fabCreate = document.getElementById('fabCreateDoc');
    const fabEdit = document.getElementById('fabEditDoc');
    const bottomNav = document.querySelector('.bottom-nav');
    const docLibrary = document.getElementById('docLibrary');

    const isLibraryVisible = docLibrary && docLibrary.style.display !== 'none';
    const hasDocument = !!this.app.documentId;

    if (isLibraryVisible) {
      if (fabCreate) fabCreate.style.display = 'flex';
      if (fabEdit) fabEdit.style.display = 'none';
      if (bottomNav) bottomNav.style.display = 'flex';
    } else if (hasDocument) {
      if (fabCreate) fabCreate.style.display = 'none';
      if (fabEdit) fabEdit.style.display = 'flex';
      if (bottomNav) bottomNav.style.display = 'none';
    }
  }

  setMobileEditMode(active) {
    const toolbar = document.getElementById('mobileContextualToolbar');
    const fabEdit = document.getElementById('fabEditDoc');
    const header = document.querySelector('.header');

    if (active) {
      if (toolbar) toolbar.style.display = 'block';
      if (fabEdit) fabEdit.style.display = 'none';
      if (header) header.style.height = '50px'; // Slimmer header in edit mode
    } else {
      if (toolbar) toolbar.style.display = 'none';
      if (fabEdit) fabEdit.style.display = 'flex';
      if (header) header.style.height = '60px';
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
    } catch (err) {
      list.innerHTML = 'Failed to load history';
    }
  }

  updateStatus(pageIndex) {
    const pageIndicator = document.getElementById('pageIndicator');
    if (!pageIndicator) return;

    pageIndicator.textContent = `Page ${pageIndex + 1}`;
    const totalPages = this.app.editor ? this.app.editor.pages.length : 1;
    pageIndicator.textContent += ` of ${totalPages}`;

    if (this.statusTimeout) clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => {
      if (this.app.editor && this.app.editor.quill) {
        const text = this.app.editor.quill.getText();
        const chars = text.replace(/\s/g, '').length;
        const words = text
          .trim()
          .split(/\s+/)
          .filter((word) => word.length > 0).length;
        const charEl = document.getElementById('charCount');
        const wordEl = document.getElementById('wordCount');
        if (charEl) charEl.textContent = `Characters: ${Math.max(0, chars)}`;
        if (wordEl) wordEl.textContent = `Words: ${words}`;
      }
    }, 500);
  }

  handleWSStatusChange(status) {
    const overlay = document.getElementById('serverOfflineOverlay');
    if (!overlay) return;

    if (status === 'connected') {
      if (this.app.connectionTimer) {
        clearTimeout(this.app.connectionTimer);
        this.app.connectionTimer = null;
      }
      overlay.style.display = 'none';
    } else {
      if (document.visibilityState === 'visible') {
        if (!this.app.connectionTimer) {
          this.app.connectionTimer = setTimeout(() => {
            if (document.visibilityState === 'visible') {
              UI.updateConnectionStatus(overlay, status);
              overlay.style.display = 'flex';
            }
            this.app.connectionTimer = null;
          }, 5000);
        }
      }
    }
  }
}
