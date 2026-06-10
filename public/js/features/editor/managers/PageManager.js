import * as Y from 'yjs';
import { Plugin } from '/js/app/Plugin.js';

export const PAGE_SIZES = {
  a4: { height: 1123, width: 794 },
  letter: { height: 1056, width: 816 },
  legal: { height: 1344, width: 816 },
};

/**
 * PageManager
 *
 * High-precision pagination engine.
 */
export class PageManager extends Plugin {
  constructor(editor, options) {
    super(editor, options);
    this.isReflowing = false;
    this.pendingUpdate = null;
    this.cascadeCount = 0;
    this.MAX_CASCADE = 5; // Prevent more than 5 automatic splits in a row

    // Initial Setup
    this.PAGE_HEIGHT = PAGE_SIZES.letter.height;
    this.PAGE_WIDTH = PAGE_SIZES.letter.width;
    this.PAGE_PADDING_Y = 120; // 60px top + 60px bottom (Matches CSS)
    this.EDITOR_PADDING_BOTTOM = 20; // Reduced from 60 to allow ~2 more rows

    this.MEASUREMENT_LEEWAY_PX = 10; // Increased from 2 for more stability
    this.HYSTERESIS_BUFFER = 80; // Space required before pulling content
    this.estimatedPageHeights = new Map();
    this.reflowTimeout = null;
    this.isProcessingReflow = false;
    this.pendingReflow = false;
    this.updateWaterline();
  }

  updateWaterline() {
    this.MAX_CONTENT_HEIGHT = this.PAGE_HEIGHT - this.PAGE_PADDING_Y - this.EDITOR_PADDING_BOTTOM;
  }

  setPageSize(sizeName) {
    const size = PAGE_SIZES[sizeName] || PAGE_SIZES.letter;
    this.PAGE_HEIGHT = size.height;
    this.PAGE_WIDTH = size.width;
    this.updateWaterline();
    this.performReflowCheck();
  }

  getScale() {
    return (this.editor.currentZoom || 100) / 100;
  }

  handleContentChange() {
    // We now allow 'api' source to trigger reflows so collaborators stay in sync.
    // The debounce below prevents this from being too expensive during rapid remote sync.
    if (this.reflowTimeout) clearTimeout(this.reflowTimeout);
    this.reflowTimeout = setTimeout(() => {
      this.performReflowCheck();
    }, 100);
  }

  performReflowCheck(isAutoCascade = false) {
    if (this.isProcessingReflow) {
      this.pendingReflow = true;
      return;
    }

    if (isAutoCascade) {
      this.cascadeCount++;
    } else {
      this.cascadeCount = 0;
    }

    if (this.cascadeCount > this.MAX_CASCADE) {
      console.warn(
        `[PageManager] Max cascade reached (${this.MAX_CASCADE}). Scheduling safety reflow.`
      );
      this.cascadeCount = 0;
      // Schedule a safety reflow with a longer delay to ensure eventual stability
      setTimeout(() => this.performReflowCheck(), 500);
      return;
    }

    this.isProcessingReflow = true;
    this.pendingReflow = false;

    try {
      const pages = this.editor.yPages.toArray();
      for (let i = 0; i < pages.length; i++) {
        const pageMap = pages[i];
        const pageId = pageMap.get('id');
        const quill = this.editor.pageQuillInstances.get(pageId);
        if (!quill) continue;

        const scale = this.getScale();
        const totalLength = quill.getLength();

        // Handle Empty Pages (except the last one)
        if (totalLength <= 1 && i < pages.length - 1) {
          this.editor.doc.transact(() => {
            this.editor.yPages.delete(i, 1);
          });
          this.scheduleReflow(true);
          return;
        }

        const lastCharBounds = quill.getBounds(totalLength - 1);
        const actualBottom = (lastCharBounds ? lastCharBounds.bottom : 0) / scale;

        // --- OVERFLOW CHECK ---
        if (actualBottom > this.MAX_CONTENT_HEIGHT + this.MEASUREMENT_LEEWAY_PX) {
          const overflow = this.findOverflowPointPrecise(quill);

          // Root Cause Fixer: If the very first element overflows, it's too big for any page.
          // We must constrain it instead of moving it to an infinite loop of new pages.
          if (overflow.hasOverflow && overflow.splitIndex === 0) {
            const constrained = this.constrainLargeElements(quill);
            if (constrained) {
              this.scheduleReflow(true);
              return;
            }
          }

          if (overflow.hasOverflow) {
            this.splitAndMoveToNextPage(i, overflow.splitIndex);
            return;
          }
        }

        // --- UNDERFLOW CHECK ---
        // Oscillation Guard: Use a larger buffer for pulling than splitting
        if (
          i < pages.length - 1 &&
          actualBottom < this.MAX_CONTENT_HEIGHT - this.HYSTERESIS_BUFFER
        ) {
          const merged = this.attemptMergeFromNextPage(i);
          if (merged) return;
        }
      }
    } finally {
      this.isProcessingReflow = false;
      if (this.pendingReflow) {
        this.scheduleReflow(this.cascadeCount > 0);
      }
    }
  }

  constrainLargeElements(quill) {
    const scale = this.getScale();
    const lines = quill.getLines();
    let modified = false;

    lines.forEach((line) => {
      const index = quill.getIndex(line);
      const bounds = quill.getBounds(index + line.length() - 1);
      const height = (bounds ? bounds.height : 0) / scale;

      if (height > this.MAX_CONTENT_HEIGHT) {
        // Look for images in this line
        const ops = quill.getContents(index, line.length()).ops;
        ops.forEach((op, opIdx) => {
          if (op.insert && op.insert.image) {
            console.log(
              `[PageManager] Constraining oversized image: ${height.toFixed(1)}px -> ${this.MAX_CONTENT_HEIGHT}px`
            );
            quill.formatText(
              index + opIdx,
              1,
              {
                height: `${Math.floor(this.MAX_CONTENT_HEIGHT - 10)}px`,
                width: 'auto', // Maintain aspect ratio
              },
              'user'
            );
            modified = true;
          }
        });
      }
    });

    return modified;
  }

  scheduleReflow(isCascade = false) {
    if (this.reflowTimeout) clearTimeout(this.reflowTimeout);
    this.reflowTimeout = setTimeout(
      () => {
        this.performReflowCheck(isCascade);
      },
      isCascade ? 50 : 0
    );
  }

  findOverflowPoint(quill) {
    return this.findOverflowPointPrecise(quill);
  }

  findOverflowPointPrecise(quill) {
    const scale = this.getScale();
    const lines = quill.getLines();
    if (lines.length === 0) return { hasOverflow: false, splitIndex: 0 };

    // 1. Find the Block (Paragraph) that overflows
    let low = 0;
    let high = lines.length - 1;
    let overflowingLineIndex = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const line = lines[mid];
      const index = quill.getIndex(line);
      const bounds = quill.getBounds(index + line.length() - 1);
      const logicalBottom = (bounds ? bounds.bottom : 0) / scale;

      if (logicalBottom > this.MAX_CONTENT_HEIGHT) {
        overflowingLineIndex = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    if (overflowingLineIndex === -1) return { hasOverflow: false, splitIndex: 0 };

    // 2. Character-Level Precision
    // If the block itself starts *before* the overflow but ends *after* it,
    // we need to split *inside* the block.
    const targetLine = lines[overflowingLineIndex];
    const startIndex = quill.getIndex(targetLine);
    const length = targetLine.length();

    // Binary search for the character that crosses the line
    let charLow = 0;
    let charHigh = length - 1;
    let splitOffset = 0;

    // Optimization: If the start of the block is already overflowing,
    // we must split at the start (or constrain it if it's an image/huge text).
    const startBounds = quill.getBounds(startIndex);
    if (startBounds && startBounds.top / scale > this.MAX_CONTENT_HEIGHT) {
      return { hasOverflow: true, splitIndex: startIndex };
    }

    while (charLow <= charHigh) {
      const mid = Math.floor((charLow + charHigh) / 2);
      const bounds = quill.getBounds(startIndex + mid);
      const logicalBottom = (bounds ? bounds.bottom : 0) / scale;

      if (logicalBottom > this.MAX_CONTENT_HEIGHT) {
        splitOffset = mid;
        charHigh = mid - 1;
      } else {
        charLow = mid + 1;
      }
    }

    // If we found a split point inside the line, use it.
    // Otherwise, default to start of line (though logicalBottom check above covers this).
    let splitIndex = startIndex + splitOffset;

    // Safety: Prevent splitting at 0 (moving entire page) if there's content.
    // This prevents the "Delete Empty Page" infinite loop if the first char overflows.
    // We force at least one character to stay.
    if (splitIndex === 0 && quill.getLength() > 1) {
      splitIndex = 1;
    }

    return { hasOverflow: true, splitIndex };
  }

  splitAndMoveToNextPage(pageIndex, splitIndex) {
    const currentPageMap = this.editor.yPages.get(pageIndex);
    const currentQuill = this.editor.pageQuillInstances.get(currentPageMap.get('id'));

    const totalLength = currentQuill.getLength();
    // Ensure we don't try to split at or after the mandatory trailing newline
    const safeSplitIndex = Math.min(splitIndex, totalLength - 1);

    const selection = currentQuill.getSelection();
    const shouldMoveCursor = selection && selection.index >= safeSplitIndex;
    const relativeCursorIndex = shouldMoveCursor ? selection.index - safeSplitIndex : 0;

    // Get content excluding the mandatory trailing newline
    const moveLength = totalLength - 1 - safeSplitIndex;
    const contentToMove =
      moveLength > 0 ? currentQuill.getContents(safeSplitIndex, moveLength) : null;

    this.editor.doc.transact(() => {
      if (moveLength > 0) {
        currentQuill.deleteText(safeSplitIndex, moveLength, 'user');
      }

      const nextPageIndex = pageIndex + 1;
      const nextPageMap = this.editor.yPages.get(nextPageIndex);
      const nextQuill = nextPageMap
        ? this.editor.pageQuillInstances.get(nextPageMap.get('id'))
        : null;

      if (nextQuill) {
        if (contentToMove && contentToMove.ops && contentToMove.ops.length > 0) {
          nextQuill.updateContents(contentToMove, 'user');
        }
      } else {
        const newPageMap = new Y.Map();
        newPageMap.set('id', Math.random().toString(36).substr(2, 9));
        const yText = new Y.Text();
        if (contentToMove && contentToMove.ops) {
          yText.applyDelta(contentToMove.ops);
        }
        newPageMap.set('content', yText);
        this.editor.yPages.insert(nextPageIndex, [newPageMap]);
      }
    });

    if (shouldMoveCursor) {
      // Immediately switch and restore selection
      this.editor.switchToPage(pageIndex + 1, Math.max(0, relativeCursorIndex));
    }

    this.scheduleReflow(true);
  }

  attemptMergeFromNextPage(pageIndex) {
    const pages = this.editor.yPages.toArray();
    if (pageIndex >= pages.length - 1) return false;

    const currentMap = pages[pageIndex];
    const nextMap = pages[pageIndex + 1];

    const currentQuill = this.editor.pageQuillInstances.get(currentMap.get('id'));
    const nextQuill = this.editor.pageQuillInstances.get(nextMap.get('id'));

    if (!currentQuill || !nextQuill) return false;

    const scale = this.getScale();
    const selection = nextQuill.getSelection();
    const shouldMoveCursor = selection !== null;
    const joinPoint = Math.max(0, currentQuill.getLength() - 1);

    if (nextQuill.getLength() <= 1) {
      this.editor.doc.transact(() => {
        this.editor.yPages.delete(pageIndex + 1, 1);
      });
      if (shouldMoveCursor) {
        this.editor.switchToPage(pageIndex, joinPoint, 'auto');
      }
      this.scheduleReflow(true);
      return true;
    }

    // Aggressive Pull: Try to pull multiple lines as long as they fit
    const lines = nextQuill.getLines();
    let linesToMove = 0;
    let cumulativeHeight = 0;

    // Calculate current bottom of the target page
    const lastCharBounds = currentQuill.getBounds(joinPoint);
    const currentBottom = (lastCharBounds ? lastCharBounds.bottom : 0) / scale;
    const availableSpace = this.MAX_CONTENT_HEIGHT - currentBottom;

    if (availableSpace <= 5) return false; // Not enough room for even a tiny line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const index = nextQuill.getIndex(line);
      const bounds = nextQuill.getBounds(index + line.length() - 1);
      const lineHeight = (bounds ? bounds.height : 20) / scale;

      if (cumulativeHeight + lineHeight < availableSpace) {
        cumulativeHeight += lineHeight;
        linesToMove++;
      } else {
        break;
      }
    }

    if (linesToMove === 0) return false;

    // Calculate total length of content to move
    let moveLength = 0;
    for (let i = 0; i < linesToMove; i++) {
      moveLength += lines[i].length();
    }

    // Ensure we don't pull the mandatory trailing newline of the next page
    moveLength = Math.min(moveLength, nextQuill.getLength() - 1);
    if (moveLength <= 0) {
      return false;
    }

    const contentToMove = nextQuill.getContents(0, moveLength);
    const relativeCursorIndex = shouldMoveCursor ? joinPoint + selection.index : 0;

    this.editor.doc.transact(() => {
      if (contentToMove && contentToMove.ops && contentToMove.ops.length > 0) {
        // Ensure we pass the delta directly, not wrapped in a redundant object
        currentQuill.updateContents(
          {
            ops: [{ retain: joinPoint }, ...contentToMove.ops],
          },
          'user'
        );
        nextQuill.deleteText(0, moveLength, 'user');
      }

      if (nextQuill.getLength() <= 1) {
        this.editor.yPages.delete(pageIndex + 1, 1);
      }
    });
    if (shouldMoveCursor && selection.index < moveLength) {
      this.editor.switchToPage(pageIndex, relativeCursorIndex, 'auto');
    }

    this.scheduleReflow(true);
    return true;
  }
  isCursorAtBottom(pageIndex, cursorIndex) {
    const pageMap = this.editor.yPages.get(pageIndex);
    if (!pageMap) return false;
    const quill = this.editor.pageQuillInstances.get(pageMap.get('id'));
    if (!quill) return false;
    const bounds = quill.getBounds(cursorIndex);
    const scale = this.getScale();
    const logicalBottom = (bounds ? bounds.bottom : 0) / scale;
    return bounds && logicalBottom > this.MAX_CONTENT_HEIGHT - 20;
  }
  insertPageBreak(pageIndex) {
    const pageMap = this.editor.yPages.get(pageIndex);
    if (!pageMap) return;
    const quill = this.editor.pageQuillInstances.get(pageMap.get('id'));
    const selection = quill.getSelection();
    if (selection) this.splitAndMoveToNextPage(pageIndex, selection.index);
  }

  mergeWithPreviousPage(pageIndex) {
    if (pageIndex <= 0) return;

    const currentMap = this.editor.yPages.get(pageIndex);

    const prevMap = this.editor.yPages.get(pageIndex - 1);

    // Force mount the previous page so we can interact with its Quill instance

    this.editor.mountPage(prevMap.get('id'));

    const currentQuill = this.editor.pageQuillInstances.get(currentMap.get('id'));

    const prevQuill = this.editor.pageQuillInstances.get(prevMap.get('id'));

    if (!prevQuill || !currentQuill) return;

    // Get content excluding the trailing newline to avoid creating empty lines on merge

    const currentLength = currentQuill.getLength();

    const content =
      currentLength > 1 ? currentQuill.getContents(0, currentLength - 1) : { ops: [] };

    const joinPoint = Math.max(0, prevQuill.getLength() - 1);

    this.editor.doc.transact(() => {
      if (content.ops.length > 0) {
        prevQuill.updateContents({ ops: [{ retain: joinPoint }, ...content.ops] }, 'user');
      }

      this.editor.yPages.delete(pageIndex, 1);
    });

    this.editor.switchToPage(pageIndex - 1, joinPoint, 'auto');

    this.scheduleReflow(true);
  }
}
