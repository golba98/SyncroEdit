/**
 * @jest-environment jsdom
 */
import { UIManager } from '../../../public/js/features/ui/UIManager.js';
import { LibraryManager } from '../../../public/js/features/library/LibraryManager.js';

// Mock dependencies
jest.mock('../../../public/js/features/editor/editor.js');
jest.mock('../../../public/js/app/network.js');
jest.mock('../../../public/js/features/theme/background.js', () => ({
  DynamicBackground: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    destroy: jest.fn(),
    setTheme: jest.fn(),
  })),
}));

describe('Document Opening Flow', () => {
  let app;
  let uiManager;
  let libraryManager;

  beforeEach(() => {
    // Setup DOM
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    document.body.innerHTML = `
        <div id="bootLoader" style="display: none;"></div>
        <div id="documentOpeningLoader" hidden>
          <div id="documentOpeningTitle"></div>
        </div>
        <div id="docLibrary" style="display: block;" class="view-visible"></div>
        <div id="libraryOverlay" style="display: block;" class="view-visible"></div>
        <div id="editorSkeleton" class="hidden"></div>
        <div class="header"></div>
        <div class="ribbon-tabs"></div>
        <div class="ribbon-content"></div>
    `;

    // Initialize Mock App and Managers
    app = {
      documentId: null,
      openingDocumentId: null,
      documentLoadState: 'idle',
      setDocumentLifecycleState: jest.fn(),
      isEditorReadyForCurrentDocument: jest.fn().mockReturnValue(false),
      loadDocument: jest.fn().mockResolvedValue(true),
    };
    uiManager = new UIManager(app);
    libraryManager = new LibraryManager(app);
    app.uiManager = uiManager;
    app.libraryManager = libraryManager;

    // Mock network
    const { Network } = require('../../../public/js/app/network.js');
    Network.createDocument = jest.fn().mockResolvedValue({ _id: 'new-doc-id' });

    document.body.dataset.viewState = 'dashboard';
  });

  test('createNewDocument shows loader immediately with "Creating document..."', async () => {
    const loader = document.getElementById('documentOpeningLoader');
    const title = document.getElementById('documentOpeningTitle');

    expect(loader.hidden).toBe(true);

    const promise = libraryManager.createNewDocument();

    // Loader should show immediately (synchronously or before the first await)
    expect(loader.hidden).toBe(false);
    expect(title.textContent).toBe('Creating document...');
    expect(document.body.dataset.viewState).toBe('opening-document');

    await promise;
  });

  test('openDocument shows loader immediately with "Opening document..."', async () => {
    const loader = document.getElementById('documentOpeningLoader');
    const title = document.getElementById('documentOpeningTitle');

    expect(loader.hidden).toBe(true);

    const promise = libraryManager.openDocument('some-doc-id');

    expect(loader.hidden).toBe(false);
    expect(title.textContent).toBe('Opening document...');
    expect(document.body.dataset.viewState).toBe('opening-document');

    await promise;
  });

  test('dashboard is NOT hidden while in opening-document state', async () => {
    const library = document.getElementById('docLibrary');

    await libraryManager.openDocument('some-doc-id');

    // Even after startEditorTransition's 250ms timeout (if we were using real timers)
    // but here we check immediately after state change
    expect(document.body.dataset.viewState).toBe('opening-document');
    expect(library.style.display).toBe('block'); // Should stay block (dimmed via CSS)
  });

  test('loader hides when editor reaches ready state', () => {
    const loader = document.getElementById('documentOpeningLoader');
    uiManager.showDocumentOpeningLoader('Test');
    expect(loader.hidden).toBe(false);

    uiManager.applyViewState('editor-ready');
    expect(loader.hidden).toBe(true);
  });

  test('assertNoBlankOpeningState restores loader if state is opening but loader is hidden', () => {
    const loader = document.getElementById('documentOpeningLoader');
    document.body.dataset.viewState = 'opening-document';
    loader.hidden = true;

    uiManager.assertNoBlankOpeningState();

    expect(loader.hidden).toBe(false);
    expect(document.getElementById('documentOpeningTitle').textContent).toBe('Opening document...');
  });
});
