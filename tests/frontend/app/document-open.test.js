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
        <div class="header"></div>
        <div class="ribbon-tabs"></div>
        <div class="ribbon-content"></div>
        <div class="main-workspace">
          <div id="editorSkeleton" class="hidden"></div>
          <div id="editorWorkspaceLoader" hidden>
            <div class="editor-workspace-loader-card">
              <div class="loader-document-icon">⌁</div>
              <div class="loader-title">Opening document...</div>
              <div class="loader-subtitle">Preparing your workspace</div>
              <div class="loader-progress"><span></span></div>
            </div>
          </div>
          <div id="pagesContainer" style="opacity: 0;"></div>
        </div>
    `;

    // Initialize Mock App and Managers
    app = {
      user: { isEmailVerified: true },
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

  test('editor shell visible + document not ready shows workspace loader', () => {
    const loader = document.getElementById('editorWorkspaceLoader');
    expect(loader.hidden).toBe(true);

    uiManager.setDocumentOpenState('opening');
    expect(loader.hidden).toBe(false);
  });

  test('pagesContainer hidden before ready shows workspace loader', () => {
    const pagesContainer = document.getElementById('pagesContainer');
    pagesContainer.style.opacity = '0';

    uiManager.preventBlackEditorLoadingState();

    const loader = document.getElementById('editorWorkspaceLoader');
    expect(loader.hidden).toBe(false);
  });

  test('workspace loader text is "Creating document..." for blank docs', () => {
    const loader = document.getElementById('editorWorkspaceLoader');
    uiManager.setDocumentOpenState('creating');

    expect(loader.querySelector('.loader-title').textContent).toBe('Creating document...');
  });

  test('workspace loader text is "Opening document..." for existing docs', () => {
    const loader = document.getElementById('editorWorkspaceLoader');
    uiManager.setDocumentOpenState('opening');

    expect(loader.querySelector('.loader-title').textContent).toBe('Opening document...');
  });

  test('workspace loader changes to "Syncing document..." during initial sync', () => {
    const loader = document.getElementById('editorWorkspaceLoader');
    uiManager.setDocumentOpenState('initial-syncing');

    expect(loader.querySelector('.loader-title').textContent).toBe('Syncing document...');
  });

  test('workspace loader hides only after editor ready', () => {
    const loader = document.getElementById('editorWorkspaceLoader');
    uiManager.setDocumentOpenState('opening');
    expect(loader.hidden).toBe(false);

    uiManager.clearOpeningDocumentState();
    expect(loader.hidden).toBe(true);
  });

  test('workspace loader does not hide if hideEditorWorkspaceLoader is called before editor is ready', () => {
    const loader = document.getElementById('editorWorkspaceLoader');
    uiManager.setDocumentOpenState('opening');
    expect(loader.hidden).toBe(false);

    // Call hideEditorWorkspaceLoader while editorReady is 'false'
    uiManager.hideEditorWorkspaceLoader();
    // Loader should still be visible because editorReady is 'false'
    expect(loader.hidden).toBe(false);
  });

  test('showEditorWorkspaceLoader removes the HTML hidden attribute', () => {
    const loader = document.getElementById('editorWorkspaceLoader');
    loader.setAttribute('hidden', '');
    expect(loader.hasAttribute('hidden')).toBe(true);

    uiManager.showEditorWorkspaceLoader();
    expect(loader.hasAttribute('hidden')).toBe(false);
    expect(loader.hidden).toBe(false);
  });

  test('black workspace state is impossible: editor visible + pages hidden + loader hidden should auto-show loader', () => {
    const loader = document.getElementById('editorWorkspaceLoader');
    loader.hidden = true;
    document.body.dataset.editorReady = 'false';

    const mainWorkspace = document.querySelector('.main-workspace');
    mainWorkspace.style.display = 'block';

    const pagesContainer = document.getElementById('pagesContainer');
    pagesContainer.style.opacity = '0';

    uiManager.preventBlackEditorLoadingState();

    expect(loader.hidden).toBe(false);
  });

  test('reconnect after ready does not show workspace loader', () => {
    // Set to ready state
    uiManager.clearOpeningDocumentState();

    const loader = document.getElementById('editorWorkspaceLoader');
    expect(loader.hidden).toBe(true);

    // Call status change for reconnecting
    app.isEditorReadyForCurrentDocument.mockReturnValue(true);
    uiManager.setDocumentOpenState('initial-syncing');

    // Should not show loader because we are already ready
    expect(loader.hidden).toBe(true);
  });

  test('typing after ready does not show workspace loader', () => {
    uiManager.clearOpeningDocumentState();

    const loader = document.getElementById('editorWorkspaceLoader');
    expect(loader.hidden).toBe(true);

    // Attempting to set document open state again (e.g. from post-ready events)
    app.isEditorReadyForCurrentDocument.mockReturnValue(true);
    uiManager.setDocumentOpenState('loading-content');

    expect(loader.hidden).toBe(true);
  });
});
