import { Plugin } from '/js/app/Plugin.js';

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class SearchManager extends Plugin {
  constructor(editor, options) {
    super(editor, options);
    this.matches = [];
    this.currentMatchIndex = -1;
    this.currentTerm = '';
    this.isCaseSensitive = false;

    // UI Elements
    this.dialog = document.getElementById('searchDialog');
    this.findInput = document.getElementById('findInput');
    this.replaceInput = document.getElementById('replaceInput');
    this.matchCountEl = document.getElementById('searchMatchCount');
  }

  init() {
    this.setupListeners();
  }

  setupListeners() {
    if (!this.dialog) return;

    // Toggle Button
    const toggleBtn = document.getElementById('toggleSearchBtn');
    if (toggleBtn) {
      this.addDisposableListener(toggleBtn, 'click', () => {
        this.toggle();
      });
    }

    // Global Shortcut (Ctrl+F)
    this.addDisposableListener(document, 'keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this.open();
      }
      if (e.key === 'Escape' && this.dialog.style.display === 'flex') {
        this.close();
      }
    });

    // Find Next
    const findNextBtn = document.getElementById('findNextBtn');
    if (findNextBtn) {
      this.addDisposableListener(findNextBtn, 'click', () => {
        this.findNext();
      });
    }

    // Find Previous
    const findPrevBtn = document.getElementById('findPrevBtn');
    if (findPrevBtn) {
      this.addDisposableListener(findPrevBtn, 'click', () => {
        this.findPrevious();
      });
    }

    // Replace
    const replaceBtn = document.getElementById('replaceBtn');
    if (replaceBtn) {
      this.addDisposableListener(replaceBtn, 'click', () => {
        this.replaceCurrent();
      });
    }

    // Replace All
    const replaceAllBtn = document.getElementById('replaceAllBtn');
    if (replaceAllBtn) {
      this.addDisposableListener(replaceAllBtn, 'click', () => {
        this.replaceAll();
      });
    }

    // Input Changes
    if (this.findInput) {
      this.addDisposableListener(this.findInput, 'input', (e) => {
        this.search(e.target.value);
      });

      this.addDisposableListener(this.findInput, 'keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) this.findPrevious();
          else this.findNext();
        }
      });
    }

    // Close
    const closeSearchBtn = document.getElementById('closeSearchBtn');
    if (closeSearchBtn) {
      this.addDisposableListener(closeSearchBtn, 'click', () => {
        this.close();
      });
    }
  }

  toggle() {
    if (this.dialog.style.display === 'flex') {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.dialog.style.display = 'flex';
    this.findInput.focus();
    if (this.findInput.value) {
      // Re-run search to refresh state, but don't jump
      this.search(this.findInput.value);
      this.findInput.select();
    }
  }

  close() {
    this.dialog.style.display = 'none';
    this.matches = [];
    this.currentMatchIndex = -1;
    if (this.editor.quill) {
      this.editor.quill.focus();
    }
  }

  search(term) {
    this.currentTerm = term;
    this.matches = [];
    this.currentMatchIndex = -1; // Reset selection state
    this.matchCountEl.textContent = '0/0';

    if (!term) return;

    const pages = this.editor.yPages.toArray();
    const escapedTerm = escapeRegExp(term);
    const regex = new RegExp(escapedTerm, this.isCaseSensitive ? 'g' : 'gi');

    pages.forEach((pageMap, pageIndex) => {
      const yText = pageMap.get('content');
      const text = yText.toString();
      let match;

      while ((match = regex.exec(text)) !== null) {
        this.matches.push({
          pageIndex,
          index: match.index,
          length: match[0].length,
          text: match[0],
        });
      }
    });

    if (this.matches.length > 0) {
      this.updateCount();
      // Crucial Change: Do NOT call findNext() here.
      // We just updated the match list. We wait for user action to navigate.
    } else {
      this.matchCountEl.textContent = 'No results';
    }
  }

  findNext() {
    if (this.matches.length === 0) return;

    // If no match is currently selected, find the nearest one relative to cursor
    if (this.currentMatchIndex === -1) {
      this.currentMatchIndex = this.findNearestMatchIndex();
    } else {
      this.currentMatchIndex++;
      if (this.currentMatchIndex >= this.matches.length) {
        this.currentMatchIndex = 0; // Wrap around
      }
    }

    this.highlightMatch(this.matches[this.currentMatchIndex]);
    this.updateCount();
  }

  findPrevious() {
    if (this.matches.length === 0) return;

    if (this.currentMatchIndex === -1) {
      // If starting fresh backwards, we want the one *before* cursor,
      // effectively wrapping to the one before the "nearest next"
      const nearest = this.findNearestMatchIndex();
      this.currentMatchIndex = nearest - 1;
    } else {
      this.currentMatchIndex--;
    }

    if (this.currentMatchIndex < 0) {
      this.currentMatchIndex = this.matches.length - 1; // Wrap around
    }

    this.highlightMatch(this.matches[this.currentMatchIndex]);
    this.updateCount();
  }

  findNearestMatchIndex() {
    // Determine user's current location
    const currentPageIndex = this.editor.currentPageIndex;
    let cursorIndex = 0;

    if (this.editor.quill) {
      const range = this.editor.quill.getSelection();
      if (range) cursorIndex = range.index;
    }

    // Find first match that is AFTER the current cursor position
    const nearestIndex = this.matches.findIndex((m) => {
      if (m.pageIndex > currentPageIndex) return true;
      if (m.pageIndex === currentPageIndex && m.index >= cursorIndex) return true;
      return false;
    });

    // If found, return it. If not (we are at end of doc), return 0 (wrap to start)
    return nearestIndex !== -1 ? nearestIndex : 0;
  }

  updateCount() {
    if (this.currentMatchIndex === -1) {
      this.matchCountEl.textContent = `${this.matches.length} found`;
    } else {
      this.matchCountEl.textContent = `${this.currentMatchIndex + 1}/${this.matches.length}`;
    }
  }

  highlightMatch(match) {
    if (!match) return;

    // Switch to page if needed
    if (this.editor.currentPageIndex !== match.pageIndex) {
      this.editor.switchToPage(match.pageIndex);
    }

    // Wait for mount if needed (switchToPage handles mounting, but just in case)
    setTimeout(() => {
      const quill = this.editor.pageQuillInstances.get(
        this.editor.yPages.get(match.pageIndex).get('id')
      );

      if (quill) {
        quill.setSelection(match.index, match.length);
        // Ensure we scroll into view
        this.editor.cursorManager.scrollToCursor(match.pageIndex, 'smooth', match.index);
      }
    }, 50);
  }

  replaceCurrent() {
    if (this.currentMatchIndex === -1) {
      // If user clicks replace without navigating, we should probably target the "nearest" or first match
      // But standard behavior is usually to act on selection.
      // Let's force a findNext first to select something.
      this.findNext();
      return;
    }

    if (this.matches.length === 0) return;

    const match = this.matches[this.currentMatchIndex];
    const newText = this.replaceInput.value;
    const pageMap = this.editor.yPages.get(match.pageIndex);
    const yText = pageMap.get('content');

    // Apply to Yjs directly
    this.editor.doc.transact(() => {
      yText.delete(match.index, match.length);
      yText.insert(match.index, newText);
    });

    // Re-run search to update indices
    // (Optimized: could just shift indices, but re-search is safer for consistency)
    this.search(this.currentTerm);

    // Try to stay on roughly the same match index
    if (this.matches.length > 0) {
      // We just replaced the item at currentMatchIndex. The array has shifted or stayed same size.
      // The "next" item is now at the same index (if it existed) or we are at end.
      if (this.currentMatchIndex >= this.matches.length) {
        this.currentMatchIndex = 0;
      }
      // Auto-highlight the next one for rapid replace
      this.highlightMatch(this.matches[this.currentMatchIndex]);
      this.updateCount();
    }
  }

  replaceAll() {
    if (this.matches.length === 0) return;

    const newText = this.replaceInput.value;
    const matches = [...this.matches]; // copy

    // Process in reverse to avoid index shifting issues within the same page
    matches.sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return b.pageIndex - a.pageIndex;
      return b.index - a.index;
    });

    this.editor.doc.transact(() => {
      matches.forEach((match) => {
        const pageMap = this.editor.yPages.get(match.pageIndex);
        const yText = pageMap.get('content');
        yText.delete(match.index, match.length);
        yText.insert(match.index, newText);
      });
    });

    this.search(this.currentTerm);
  }
}
