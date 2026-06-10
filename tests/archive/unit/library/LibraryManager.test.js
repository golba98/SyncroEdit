/**
 * @jest-environment jsdom
 */

// Mock dependencies
jest.mock('../../../public/js/app/network.js', () => ({
  Network: {
    createDocument: jest.fn(),
  },
}));

import { Network } from '../../../public/js/app/network.js';

describe('LibraryManager - Document Creation', () => {
  let libraryManager;
  let mockApp;
  let LibraryManager;

  beforeEach(() => {
    // Set up DOM
    document.body.innerHTML = `
      <div id="docLibrary" class="view-visible"></div>
      <div id="libraryOverlay" class="view-visible"></div>
    `;

    mockApp = {
      documentId: null,
      loadDocument: jest.fn().mockResolvedValue(undefined),
      showTransitionOverlay: jest.fn(),
      hideTransitionOverlay: jest.fn(),
    };

    // Import after mocks are set up
    jest.isolateModules(() => {
      const module = require('../../../public/js/features/library/LibraryManager.js');
      LibraryManager = module.LibraryManager;
    });

    libraryManager = new LibraryManager(mockApp);
  });

  afterEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('should create document without page reload', async () => {
    const mockDoc = { _id: 'test-doc-123' };
    Network.createDocument.mockResolvedValue(mockDoc);

    // Mock history.pushState to capture URL changes
    const pushStateSpy = jest.spyOn(window.history, 'pushState');

    await libraryManager.createNewDocument();

    // Should use pushState (no page reload) instead of location.href assignment
    expect(pushStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'editor', docId: 'test-doc-123' }),
      '',
      expect.stringContaining('test-doc-123')
    );

    // Should call loadDocument inline
    expect(mockApp.loadDocument).toHaveBeenCalled();
    expect(mockApp.documentId).toBe('test-doc-123');

    pushStateSpy.mockRestore();
  });

  test('should invalidate library cache on document creation', async () => {
    localStorage.setItem('syncroedit_library_cache', JSON.stringify([{ id: 'old' }]));

    Network.createDocument.mockResolvedValue({ _id: 'new-doc' });

    await libraryManager.createNewDocument();

    expect(localStorage.getItem('syncroedit_library_cache')).toBeNull();
  });

  test('should prevent double-click during creation', async () => {
    Network.createDocument.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ _id: 'doc1' }), 100))
    );

    const promise1 = libraryManager.createNewDocument();
    const promise2 = libraryManager.createNewDocument();

    await Promise.all([promise1, promise2]);

    // Should only call createDocument once
    expect(Network.createDocument).toHaveBeenCalledTimes(1);
  });
});
