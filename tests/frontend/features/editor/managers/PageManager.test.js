/**
 * @jest-environment jsdom
 */
import { PageManager } from '../../../../../public/js/features/editor/managers/PageManager.js';

// Mock Yjs and Quill dependencies
jest.mock('yjs', () => ({
  Map: jest.fn(),
  Text: jest.fn(),
}));

describe('PageManager', () => {
  let pageManager;
  let mockEditor;
  let mockQuillPage0;
  let mockQuillPage1;

  beforeEach(() => {
    mockQuillPage0 = {
      getLength: jest.fn(),
      getBounds: jest.fn(),
      getSelection: jest.fn().mockReturnValue(null),
      updateContents: jest.fn(),
      deleteText: jest.fn(),
      getLine: jest.fn(),
      getLines: jest.fn(),
      getIndex: jest.fn(),
      getText: jest.fn(),
      getContents: jest.fn(),
      root: document.createElement('div'),
    };

    mockQuillPage1 = {
      getLength: jest.fn(),
      getBounds: jest.fn(),
      getSelection: jest.fn().mockReturnValue(null),
      updateContents: jest.fn(),
      deleteText: jest.fn(),
      getLine: jest.fn(),
      getLines: jest.fn(),
      getIndex: jest.fn(),
      getText: jest.fn(),
      getContents: jest.fn(),
      root: document.createElement('div'),
    };

    mockEditor = {
      pageQuillInstances: new Map([
        ['page-0', mockQuillPage0],
        ['page-1', mockQuillPage1],
      ]),
      currentZoom: 100,
      doc: {
        transact: jest.fn((cb) => cb()),
      },
      yPages: {
        delete: jest.fn(),
        insert: jest.fn(),
        toArray: jest
          .fn()
          .mockReturnValue([
            { get: (key) => (key === 'id' ? 'page-0' : null) },
            { get: (key) => (key === 'id' ? 'page-1' : null) },
          ]),
      },
      handlePageUpdate: jest.fn(), // Mock the recursive call
      switchToPage: jest.fn(),
    };

    pageManager = new PageManager(mockEditor);
    // Overwrite handlePageUpdate to avoid async issues in test or circular deps
    pageManager.handlePageUpdate = jest.fn();
    mockQuillPage0.getLines.mockReturnValue([]);
    mockQuillPage1.getLines.mockReturnValue([{ length: () => 6 }]);
    mockQuillPage1.getIndex.mockReturnValue(0);
  });

  describe('attemptMergeFromNextPage', () => {
    it('should pull content from next page if there is space', () => {
      // 1. Setup Page 0 (Current)
      // Assume max height is around 956 (1056 - 80 - 20)
      // Content height = 500. Space = 456.
      mockQuillPage0.getLength.mockReturnValue(100);
      mockQuillPage0.getBounds.mockReturnValue({ bottom: 500 }); // Logical bottom

      // 2. Setup Page 1 (Next)
      // We use getText to find newline.
      mockQuillPage1.getText.mockReturnValue('Hello\nWorld\n');
      mockQuillPage1.getLength.mockReturnValue(12); // "Hello\nWorld\n".length

      // We use getBounds(0) to check first line height
      mockQuillPage1.getBounds.mockReturnValue({ height: 20 });

      const mockContent = { ops: [{ insert: 'Hello\n' }] };
      mockQuillPage1.getContents.mockReturnValue(mockContent);

      // 3. Execute
      pageManager.attemptMergeFromNextPage(0);

      // 4. Verify
      // Should check bounds on page 0
      expect(mockQuillPage0.getBounds).toHaveBeenCalled();

      // Should check lines on page 1
      expect(mockQuillPage1.getLines).toHaveBeenCalled();

      // Should check line height (safety check)
      expect(mockQuillPage1.getBounds).toHaveBeenCalledWith(5);

      // Should move content (length of "Hello\n" is 6)
      expect(mockEditor.doc.transact).toHaveBeenCalled();
      expect(mockQuillPage1.getContents).toHaveBeenCalledWith(0, 6);

      // Should update page 0
      expect(mockQuillPage0.updateContents).toHaveBeenCalledWith(
        {
          ops: [{ retain: 99 }, { insert: 'Hello\n' }],
        },
        'user'
      );

      // Should delete from page 1
      expect(mockQuillPage1.deleteText).toHaveBeenCalledWith(0, 6, 'user');

      // Should NOT delete page 1 (length remains > 1 after delete)
      expect(mockEditor.yPages.delete).not.toHaveBeenCalled();

      // Should trigger update check again via scheduleReflow
      const reflowSpy = jest.spyOn(pageManager, 'scheduleReflow');
      pageManager.attemptMergeFromNextPage(0);
      expect(reflowSpy).toHaveBeenCalledWith(true);
    });

    it('should NOT pull content if no space', () => {
      // 1. Setup Page 0 (Full)
      // Content height = 950. Max ~956. Space = 6.
      mockQuillPage0.getLength.mockReturnValue(100);
      mockQuillPage0.getBounds.mockReturnValue({ bottom: 950 });

      // 2. Setup Page 1
      mockQuillPage1.getText.mockReturnValue('Hello\n');
      mockQuillPage1.getLength.mockReturnValue(6);
      mockQuillPage1.getBounds.mockReturnValue({ height: 20 }); // Needs > 20 space.

      // 3. Execute
      pageManager.attemptMergeFromNextPage(0);

      // 4. Verify
      expect(mockEditor.doc.transact).not.toHaveBeenCalled();
    });

    it('should delete next page if it becomes empty after pull', () => {
      // 1. Setup Page 0 (Space available)
      mockQuillPage0.getLength.mockReturnValue(100);
      mockQuillPage0.getBounds.mockReturnValue({ bottom: 500 });

      // 2. Setup Page 1 (Almost empty)
      mockQuillPage1.getText.mockReturnValue('Hello\n');
      mockQuillPage1.getLength.mockReturnValue(6); // Initial length
      mockQuillPage1.getBounds.mockReturnValue({ height: 20 });
      mockQuillPage1.getContents.mockReturnValue({ ops: [{ insert: 'Hello\n' }] });

      // Crucial: We need to mock getLength returning 1 inside the transaction logic check
      mockQuillPage1.getLength
        .mockReturnValueOnce(6) // Initial check
        .mockReturnValueOnce(6) // Clamp check
        .mockReturnValueOnce(1); // Check inside transact

      // 3. Execute
      pageManager.attemptMergeFromNextPage(0);

      // 4. Verify
      expect(mockEditor.doc.transact).toHaveBeenCalled();
      expect(mockEditor.yPages.delete).toHaveBeenCalledWith(1, 1);

      // Verify scheduleReflow is called
      const reflowSpy = jest.spyOn(pageManager, 'scheduleReflow');
      pageManager.attemptMergeFromNextPage(0);
      expect(reflowSpy).toHaveBeenCalledWith(true);
    });
  });

  describe('findOverflowPoint', () => {
    it('should identify overflow using block-based search', () => {
      // Setup
      mockQuillPage0.getLength.mockReturnValue(100);

      // Setup Blocks (Blots)
      // Block 1: 0-50 (Fits)
      // Block 2: 50-100 (Overflows)
      const mockBlock1 = {
        length: () => 50,
        domNode: { getBoundingClientRect: () => ({ top: 100, bottom: 500 }) },
      };
      const mockBlock2 = {
        length: () => 50,
        domNode: { getBoundingClientRect: () => ({ top: 500, bottom: 1000 }) }, // Overflows MAX (956)
      };

      mockQuillPage0.getLines.mockReturnValue([mockBlock1, mockBlock2]);

      // Helper to return index based on block identity
      mockQuillPage0.getIndex.mockImplementation((block) => {
        return block === mockBlock1 ? 0 : 50;
      });

      // Mock getBounds for binary search inside Block 2
      // We expect binary search between 50 and 99.
      // Let's say index 96 is the split point (height 960)
      mockQuillPage0.getBounds.mockImplementation((index) => {
        return { bottom: index * 10 };
      });

      // Execute
      const result = pageManager.findOverflowPoint(mockQuillPage0);

      // Verify
      expect(mockQuillPage0.getLines).toHaveBeenCalled();
      // Should find Block 2 as overflow candidate
      // Should search strictly within range 50-99
      expect(result).toEqual({ hasOverflow: true, splitIndex: 92 });
    });

    it('should return no overflow if all blocks fit', () => {
      // Setup
      mockQuillPage0.getLength.mockReturnValue(100);
      const mockBlock1 = {
        length: () => 50,
        domNode: { getBoundingClientRect: () => ({ top: 100, bottom: 500 }) },
      };
      mockQuillPage0.getLines.mockReturnValue([mockBlock1]);

      // Execute
      const result = pageManager.findOverflowPoint(mockQuillPage0);

      // Verify
      expect(result).toEqual({ hasOverflow: false, splitIndex: 0 });
    });
  });
});
