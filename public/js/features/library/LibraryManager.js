import { Network } from '/js/app/network.js';
import { UI } from '/js/features/ui/ui.js';

export class LibraryManager {
  constructor(app) {
    this.app = app;
    this.isTransitioning = false;
  }

  async showLibrary() {
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
    }

    const renderList = (docs) => {
      UI.renderDocumentList(
        document.getElementById('documentList'),
        docs,
        this.app.documentId,
        (id) => {
          this.openDocument(id);
        },
        async (id) => {
          if (confirm('Delete this document?')) {
            await Network.deleteDocument(id);
            // After deletion, clear cache to force fresh fetch or update it
            localStorage.removeItem('syncroedit_library_cache');
            this.showLibrary();
          }
        },
        this.app.user._id
      );
    };

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

  async createNewDocument() {
    // Prevent rapid clicks
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      // Quick visual feedback - close library immediately
      const library = document.getElementById('docLibrary');
      const overlay = document.getElementById('libraryOverlay');
      if (library) library.classList.remove('view-visible');
      if (overlay) overlay.classList.remove('view-visible');

      // Create document in background
      const doc = await Network.createDocument();

      // Update URL without reload
      const newUrl = `${window.location.pathname}?doc=${doc._id}`;
      window.history.pushState({ view: 'editor', docId: doc._id }, '', newUrl);

      // Hide library after transition
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (library) library.style.display = 'none';
      if (overlay) overlay.style.display = 'none';

      // Invalidate library cache since we have a new doc
      localStorage.removeItem('syncroedit_library_cache');

      // Load document inline (same as openDocument does)
      this.app.documentId = doc._id;
      await this.app.loadDocument();

      this.isTransitioning = false;
    } catch (err) {
      console.error('Failed to create document:', err);
      this.isTransitioning = false;
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
    // Prevent rapid transitions
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    try {
      // Get library elements
      const library = document.getElementById('docLibrary');
      const overlay = document.getElementById('libraryOverlay');

      // Start fade-out transition
      if (library) library.classList.remove('view-visible');
      if (overlay) overlay.classList.remove('view-visible');

      // Wait for transition to complete (200ms)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Hide library after transition
      if (library) library.style.display = 'none';
      if (overlay) overlay.style.display = 'none';

      // Update URL with document ID
      const newUrl = `${window.location.pathname}?doc=${docId}`;
      window.history.pushState({ view: 'editor', docId }, '', newUrl);

      // Update app state and load document
      this.app.documentId = docId;
      await this.app.loadDocument();

      // Release transition lock
      this.isTransitioning = false;
    } catch (err) {
      console.error('Failed to open document:', err);
      this.isTransitioning = false;
      alert('Failed to open document');
    }
  }
}
