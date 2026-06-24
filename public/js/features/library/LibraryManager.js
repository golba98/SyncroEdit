import { Network } from '/js/app/network.js';
import { UI } from '/js/features/ui/ui.js';
import { debounce } from '/js/app/utils.js';

export class LibraryManager {
  constructor(app) {
    this.app = app;
    this.isTransitioning = false;
    this.openLock = false;
    this.documents = [];
    this.searchTerm = '';
    this.searchHandlerBound = false;
  }

  async showLibrary() {
    if (this.app.verificationRestricted) {
      if (this.app.uiManager) {
        this.app.uiManager.applyViewState('dashboard');
        this.app.uiManager.updateMobileUIState();
      }
      const listContainer = document.getElementById('documentList');
      if (listContainer) {
        listContainer.innerHTML =
          '<tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--text-soft);">Verify your email in Settings to access documents and collaboration.</td></tr>';
      }
      return;
    }

    // Prevent rapid transitions
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    const library = document.getElementById('docLibrary');
    const overlay = document.getElementById('libraryOverlay');
    if (!library || !overlay) {
      this.isTransitioning = false;
      return;
    }

    // Update URL to remove ?doc= parameter without reload
    if (this.app.documentId) {
      const newUrl = window.location.pathname;
      window.history.pushState({ view: 'library' }, '', newUrl);
    }

    // Prepare library for display (hidden initially for smooth transition)
    if (this.app.uiManager) {
      this.app.uiManager.applyViewState('dashboard');
    }

    library.style.display = 'block';
    overlay.style.display = 'block';

    // Force reflow to ensure display change is applied
    library.offsetHeight;

    // Add transition classes for smooth fade-in
    requestAnimationFrame(() => {
      library.classList.add('view-visible');
      overlay.classList.add('view-visible');

      // Release transition lock after animation completes
      setTimeout(() => {
        this.isTransitioning = false;
      }, 250);
    });

    const closeBtn = document.getElementById('closeLibrary');
    if (closeBtn) closeBtn.style.display = this.app.documentId ? 'block' : 'none';

    if (this.app.uiManager) {
      this.app.uiManager.updateMobileUIState();
    }

    // Bind FAB
    const fab = document.getElementById('fabCreateDoc');
    if (fab) {
      fab.onclick = () => this.createNewDocument();
      fab.style.display = this.app.verificationRestricted ? 'none' : '';
    }

    const isVerified =
      this.app.user &&
      (this.app.user.isEmailVerified === true || Number(this.app.user.isEmailVerified) === 1);
    if (!isVerified) {
      const listContainer = document.getElementById('documentList');
      if (listContainer) {
        listContainer.innerHTML =
          '<tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--text-soft);">Verify your email in Settings to access documents and collaboration.</td></tr>';
      }
      return;
    }

    const renderList = (docs) => {
      this.documents = Array.isArray(docs) ? docs : [];
      const filteredDocs = this.filterDocuments(this.documents);
      UI.renderDocumentList(
        document.getElementById('documentList'),
        filteredDocs,
        this.app.documentId,
        (id) => {
          this.openDocument(id);
        },
        async (id) => {
          if (confirm('Delete this document?')) {
            await this.deleteDocument(id);
          }
        },
        this.app.user._id
      );
    };

    this.bindSearch(renderList);

    if (this.app.verificationRestricted) {
      const listContainer = document.getElementById('documentList');
      if (listContainer) {
        listContainer.innerHTML = `
          <tr>
            <td colspan="4" style="text-align: center; padding: 24px; color: var(--text-soft);">
              Verify your email in Settings/Profile to access documents and collaboration features.
            </td>
          </tr>
        `;
      }
      this.documents = [];
      return;
    }

    // 1. Instant Cache Render
    const cachedData = localStorage.getItem('syncroedit_library_cache');
    let hasRenderedCache = false;

    if (cachedData) {
      try {
        const docs = JSON.parse(cachedData);
        if (Array.isArray(docs)) {
          renderList(docs);
          hasRenderedCache = true;
        }
      } catch (e) {
        console.warn('Failed to parse library cache', e);
      }
    }

    if (!hasRenderedCache) {
      UI.renderDocumentSkeleton(document.getElementById('documentList'));
    }

    // 2. Network Refresh (Stale-While-Revalidate)
    try {
      const data = await Network.getDocuments();
      const docs = data.documents || [];
      const newCacheString = JSON.stringify(docs);

      // Only re-render if data actually changed
      if (newCacheString !== cachedData) {
        localStorage.setItem('syncroedit_library_cache', newCacheString);
        renderList(docs);
      } else if (!hasRenderedCache) {
        // If we didn't have cache but network returned same (empty?) or cache was invalid
        renderList(docs);
      }
    } catch (err) {
      if (err.code === 'EMAIL_VERIFICATION_REQUIRED' || err.status === 403) {
        const listContainer = document.getElementById('documentList');
        if (listContainer) {
          listContainer.innerHTML =
            '<tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--text-soft);">Verify your email in Settings to access documents and collaboration.</td></tr>';
        }
        return;
      }

      console.error('Error fetching documents from network:', err);

      // Handle Auth Error (Token expired/invalid)
      if (err.message && err.message.includes('401')) {
        window.location.href = '/pages/login.html';
        return;
      }

      // If network fails and we didn't render cache, show error
      if (!hasRenderedCache) {
        const listContainer = document.getElementById('documentList');
        if (listContainer) {
          listContainer.innerHTML =
            '<tr><td colspan="4" style="text-align: center; padding: 20px;">Failed to load documents (Offline).</td></tr>';
        }
      }
    }
  }

  bindSearch(renderList) {
    if (this.searchHandlerBound) return;
    const search = document.getElementById('docSearch');
    if (!search) return;

    search.addEventListener(
      'input',
      debounce((event) => {
        this.searchTerm = event.target.value || '';
        renderList(this.documents);
      }, 180)
    );
    this.searchHandlerBound = true;
  }

  filterDocuments(docs) {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return docs;
    return docs.filter((doc) => {
      const title = String(doc.title || '').toLowerCase();
      const preview = String(doc.pages?.[0]?.content || '').toLowerCase();
      return title.includes(term) || preview.includes(term);
    });
  }

  async deleteDocument(id) {
    const previousDocs = this.documents;
    const nextDocs = previousDocs.filter((doc) => doc._id !== id);
    this.documents = nextDocs;
    localStorage.setItem('syncroedit_library_cache', JSON.stringify(nextDocs));
    UI.renderDocumentList(
      document.getElementById('documentList'),
      this.filterDocuments(nextDocs),
      this.app.documentId,
      (docId) => this.openDocument(docId),
      async (docId) => {
        if (confirm('Delete this document?')) await this.deleteDocument(docId);
      },
      this.app.user._id
    );

    try {
      await Network.deleteDocument(id);
    } catch (err) {
      console.error('Failed to delete document:', err);
      this.documents = previousDocs;
      localStorage.setItem('syncroedit_library_cache', JSON.stringify(previousDocs));
      UI.renderDocumentList(
        document.getElementById('documentList'),
        this.filterDocuments(previousDocs),
        this.app.documentId,
        (docId) => this.openDocument(docId),
        async (docId) => {
          if (confirm('Delete this document?')) await this.deleteDocument(docId);
        },
        this.app.user._id
      );
      alert('Failed to delete document. Please try again.');
    }
  }

  async createNewDocument() {
    if (this.app.verificationRestricted) {
      this.app.promptEmailVerification?.();
      return;
    }

    // Prevent rapid clicks
    if (this.openLock) return;
    console.log('[OPEN] click', { action: 'create' });
    this.openLock = true;
    this.isTransitioning = true;
    this.app.beginDocumentOpen?.({ mode: 'creating', isNewDocument: true });
    this.markCreateOpening(true);
    this.disableLibraryInteraction('create');

    try {
      this.app.setDocumentLifecycleState?.('creating');
      this.app.uiManager?.showDocumentOpeningLoader('Creating document...');
      this.app.uiManager?.applyViewState('opening-document');
      this.app.uiManager?.setOpeningDocumentState();
      await this.startEditorTransition();

      // Create document in background
      const doc = await Network.createDocument();

      // Update URL without reload
      const newUrl = `${window.location.pathname}?doc=${doc._id}`;
      window.history.pushState({ view: 'editor', docId: doc._id }, '', newUrl);

      // Invalidate library cache since we have a new doc
      localStorage.removeItem('syncroedit_library_cache');

      // Load document inline (same as openDocument does)
      this.app.documentId = doc._id;
      await this.app.loadDocument({ mode: 'creating', isNewDocument: true });

      this.openLock = false;
      this.isTransitioning = false;
      this.markCreateOpening(false);
    } catch (err) {
      console.error('Failed to create document:', err);
      this.clearOpeningStates();
      // Re-show library on error
      const library = document.getElementById('docLibrary');
      const overlay = document.getElementById('libraryOverlay');
      if (library) {
        library.style.display = 'block';
        library.classList.add('view-visible');
      }
      if (overlay) {
        overlay.style.display = 'block';
        overlay.classList.add('view-visible');
      }
      alert('Failed to create document. Please try again.');
    }
  }

  async openDocument(docId) {
    if (this.app.verificationRestricted) {
      this.app.promptEmailVerification?.();
      return;
    }

    // Prevent rapid transitions
    if (this.openLock) return;
    console.log('[OPEN] click', { action: 'open', docId });
    this.openLock = true;
    this.isTransitioning = true;
    this.app.beginDocumentOpen?.({ mode: 'opening', docId, isNewDocument: false });
    this.disableLibraryInteraction('open', docId);

    try {
      this.app.openingDocumentId = docId;
      this.markDocumentOpening(docId);
      this.app.setDocumentLifecycleState?.('opening');
      this.app.uiManager?.showDocumentOpeningLoader('Opening document...');
      this.app.uiManager?.applyViewState('opening-document');
      this.app.uiManager?.setOpeningDocumentState();
      await this.startEditorTransition();

      const newUrl = `${window.location.pathname}?doc=${docId}`;
      window.history.pushState({ view: 'editor', docId }, '', newUrl);

      this.app.documentId = docId;
      await this.app.loadDocument({ mode: 'loading-content', isNewDocument: false });

      this.openLock = false;
      this.isTransitioning = false;
    } catch (err) {
      console.error('Failed to open document:', err);
      this.clearOpeningStates();
      alert('Failed to open document');
    }
  }

  async startEditorTransition() {
    const library = document.getElementById('docLibrary');
    const overlay = document.getElementById('libraryOverlay');

    if (library) {
      library.classList.remove('view-visible');
      library.classList.add('view-exiting');
    }
    if (overlay) {
      overlay.classList.remove('view-visible');
      overlay.classList.add('view-exiting');
    }

    // Cleanup after animation finishes, but don't block the main flow
    setTimeout(() => {
      const isStillOpening = document.body.dataset.viewState === 'opening-document';
      if (library) {
        library.classList.remove('view-exiting');
        // Only hide if we are not back on the dashboard AND not currently opening a document
        if (
          !document.body.dataset.viewState ||
          (document.body.dataset.viewState !== 'dashboard' && !isStillOpening)
        ) {
          library.style.display = 'none';
        }
      }
      if (overlay) {
        overlay.classList.remove('view-exiting');
        if (
          !document.body.dataset.viewState ||
          (document.body.dataset.viewState !== 'dashboard' && !isStillOpening)
        ) {
          overlay.style.display = 'none';
        }
      }
    }, 250);
  }

  markCreateOpening(isOpening) {
    const card = document.getElementById('createNewDoc');
    if (!card) return;

    card.classList.toggle('is-opening', isOpening);
    card.setAttribute('aria-busy', String(isOpening));
    card.setAttribute('aria-disabled', String(isOpening));
    const icon = card.querySelector('i');
    if (!icon) return;
    icon.classList.toggle('fa-plus', !isOpening);
    icon.classList.toggle('fa-spinner', isOpening);
    icon.classList.toggle('fa-spin', isOpening);
  }

  markDocumentOpening(docId) {
    const row = Array.from(document.querySelectorAll('.doc-item')).find(
      (item) => item.dataset.docId === docId
    );
    if (!row) return;

    row.classList.add('is-opening');
    row.setAttribute('aria-busy', 'true');

    const icon = row.querySelector('.doc-icon-container i');
    if (icon) {
      icon.classList.remove('fa-file-alt');
      icon.classList.add('fa-spinner', 'fa-spin');
    }

    const titleWrap = row.querySelector('.doc-title-text')?.parentElement;
    if (titleWrap && !titleWrap.querySelector('.doc-opening-pill')) {
      titleWrap.insertAdjacentHTML('beforeend', '<span class="doc-opening-pill">Opening...</span>');
    }

    const deleteBtn = row.querySelector('.delete-doc-btn');
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.setAttribute('aria-disabled', 'true');
    }
  }

  disableLibraryInteraction(clickedType, clickedId) {
    // Disable Blank document card
    const createCard = document.getElementById('createNewDoc');
    if (createCard) {
      createCard.classList.add('is-disabled');
      if (clickedType !== 'create') {
        createCard.style.opacity = '0.4';
        createCard.style.pointerEvents = 'none';
      }
    }

    // Disable all recent document rows
    document.querySelectorAll('.doc-item').forEach((row) => {
      row.classList.add('is-disabled');
      row.style.pointerEvents = 'none';
      if (clickedType !== 'open' || row.dataset.docId !== clickedId) {
        row.style.opacity = '0.4';
      }
    });

    const search = document.getElementById('docSearch');
    if (search) search.disabled = true;
  }

  enableLibraryInteraction() {
    const createCard = document.getElementById('createNewDoc');
    if (createCard) {
      createCard.classList.remove('is-disabled');
      createCard.style.opacity = '';
      createCard.style.pointerEvents = '';
    }

    document.querySelectorAll('.doc-item').forEach((row) => {
      row.classList.remove('is-disabled');
      row.style.opacity = '';
      row.style.pointerEvents = '';
    });

    const search = document.getElementById('docSearch');
    if (search) search.disabled = false;
  }

  clearOpeningStates() {
    this.openLock = false;
    this.isTransitioning = false;
    this.markCreateOpening(false);
    this.enableLibraryInteraction();

    // Remove is-opening from all rows
    document.querySelectorAll('.doc-item.is-opening').forEach((row) => {
      row.classList.remove('is-opening');
      row.removeAttribute('aria-busy');

      const icon = row.querySelector('.doc-icon-container i');
      if (icon) {
        icon.classList.remove('fa-spinner', 'fa-spin');
        icon.classList.add('fa-file-alt');
      }

      row.querySelector('.doc-opening-pill')?.remove();

      const deleteBtn = row.querySelector('.delete-doc-btn');
      if (deleteBtn) {
        deleteBtn.disabled = false;
        deleteBtn.removeAttribute('aria-disabled');
      }
    });
  }
}
