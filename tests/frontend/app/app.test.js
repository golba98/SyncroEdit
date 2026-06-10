/**
 * @jest-environment jsdom
 */

import { App } from '/js/app/app.js';
import { Network } from '/js/app/network.js';
import { Auth } from '/js/features/auth/auth.js';
import { Profile } from '/js/features/profile/profile.js';
import * as Utils from '/js/app/utils.js';

// Mocks
jest.mock('/js/app/network.js');
jest.mock('/js/features/auth/auth.js');
jest.mock('/js/features/ui/ui.js');
jest.mock('/js/features/editor/editor.js');
jest.mock('/js/features/theme/theme.js');
jest.mock('/js/features/profile/profile.js');
jest.mock('/js/features/theme/background.js');
jest.mock('/js/app/utils.js', () => ({
  ...jest.requireActual('/js/app/utils.js'),
  navigateTo: jest.fn(),
}));

describe('App Core Initialization', () => {
  const originalURLSearchParams = global.URLSearchParams;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="bootLoader"></div>
      <div id="authGuard" style="display: none; opacity: 0;"></div>
      <div id="authGuardText"></div>
      <div id="docLibrary"></div>
      <div id="libraryOverlay"></div>
      <button id="closeLibrary"></button>
      <div id="createNewDoc"><i class="fas fa-plus"></i></div>
      <input id="docSearch" />
      <div id="documentList"></div>
      <div id="activeCollaborators"></div>
      <div id="connectionBadge" hidden></div>
      <div id="saveStatusIndicator"></div>
      <div id="serverOfflineOverlay"></div>
      <div id="editorSkeleton" class="hidden">
        <div id="editorSkeletonStatus"></div>
        <div id="editorSkeletonTitle"></div>
        <div id="editorSkeletonDescription"></div>
        <div id="editorSkeletonMessage" hidden></div>
        <div id="editorOpenError" hidden>
          <div id="editorOpenErrorMessage"></div>
          <button id="editorOpenRetry"></button>
          <button id="editorOpenBack"></button>
        </div>
      </div>
      <div id="pagesContainer"></div>
      
      <div id="userProfileTrigger">
        <img id="headerPfp" />
        <div id="headerInitials"></div>
        <i id="headerUserIcon"></i>
      </div>
      
      <div id="profileModal">
        <img id="profilePfp" />
        <div id="profileInitials"></div>
        <div id="profilePfpPlaceholder"></div>
        <input id="profileEmailInput" />
        <input id="profileUsernameInput" />
        <textarea id="profileBioInput"></textarea>
        <button id="saveGeneralBtn"></button>
      </div>
    `;

    // Default Profile load success
    Profile.prototype.loadProfile = jest
      .fn()
      .mockResolvedValue({ _id: 'user1', username: 'TestUser' });

    // Default Network mocks
    Network.getDocuments.mockResolvedValue({ documents: [] });
    Network.addToRecent.mockResolvedValue({});
    Network.createDocument.mockResolvedValue({ _id: 'new-doc' });

    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });

    window.requestAnimationFrame = jest.fn().mockImplementation((cb) => cb());

    // Mock URLSearchParams globally
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue(null), // Default no doc param
    }));
  });

  afterAll(() => {
    global.URLSearchParams = originalURLSearchParams;
  });

  it('should show library if no document ID in URL', async () => {
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue(null),
    }));

    const app = new App();

    // Wait for async init
    await new Promise(process.nextTick);

    expect(Profile.prototype.loadProfile).toHaveBeenCalledWith({ silent: true });
    expect(document.getElementById('authGuard').style.display).toBe('none');

    const lib = document.getElementById('docLibrary');
    expect(lib.style.display).toBe('block');
    expect(Network.getDocuments).toHaveBeenCalled();
  });

  it('should load document if document ID is present', async () => {
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('123'),
    }));

    const app = new App();

    // Wait for async init
    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    expect(Profile.prototype.loadProfile).toHaveBeenCalledWith({ silent: true });
    expect(document.getElementById('authGuard').style.display).toBe('none');

    const lib = document.getElementById('docLibrary');
    expect(lib.style.display).toBe('none');
    expect(Network.addToRecent).toHaveBeenCalledWith('123');
  });

  it('should redirect to login if profile load fails', async () => {
    Profile.prototype.loadProfile = jest.fn().mockResolvedValue(null);

    const app = new App();
    await new Promise(process.nextTick);

    expect(Utils.navigateTo).toHaveBeenCalledWith('pages/login.html');
    expect(document.getElementById('authGuard').style.display).toBe('none');
  });

  it('should preserve doc param when redirecting after failed session check', async () => {
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('doc-42'),
    }));
    Profile.prototype.loadProfile = jest.fn().mockResolvedValue(null);

    const app = new App();
    await new Promise(process.nextTick);

    expect(Utils.navigateTo).toHaveBeenCalledWith('pages/login.html?doc=doc-42');
  });

  it('should update connection badge without showing the connection overlay', async () => {
    jest.useFakeTimers();
    try {
      global.URLSearchParams = jest.fn(() => ({
        get: jest.fn().mockReturnValue('123'),
      }));

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });

      const app = new App();
      jest.runAllTicks();

      const overlay = document.getElementById('serverOfflineOverlay');
      const badge = document.getElementById('connectionBadge');
      overlay.style.display = 'none';

      app.uiManager.documentOpenState = 'ready';
      app.handleWSStatusChange('connecting');
      jest.advanceTimersByTime(5000);

      expect(overlay.style.display).toBe('none');
      expect(badge.hidden).toBe(false);
      expect(badge.textContent).toBe('Connecting');
      expect(badge.dataset.status).toBe('connecting');
    } finally {
      jest.useRealTimers();
    }
  });

  it('should recheck session silently when tab becomes visible', async () => {
    const app = new App();
    await new Promise(process.nextTick);

    Profile.prototype.loadProfile.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(process.nextTick);

    expect(Profile.prototype.loadProfile).toHaveBeenCalledWith({ silent: true });
  });

  it('prevents duplicate blank document creation while opening', async () => {
    const app = new App();
    await new Promise(process.nextTick);
    app.loadDocument = jest.fn().mockResolvedValue();

    const pendingCreate = new Promise((resolve) => {
      setTimeout(() => resolve({ _id: 'new-doc' }), 20);
    });
    Network.createDocument.mockReturnValue(pendingCreate);

    const first = app.libraryManager.createNewDocument();
    const second = app.libraryManager.createNewDocument();
    await Promise.resolve();

    expect(Network.createDocument).toHaveBeenCalledTimes(1);
    await Promise.all([first, second]);
    expect(app.loadDocument).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate recent document opens while opening', async () => {
    const app = new App();
    await new Promise(process.nextTick);
    app.loadDocument = jest.fn().mockResolvedValue();

    const first = app.libraryManager.openDocument('doc-1');
    const second = app.libraryManager.openDocument('doc-1');

    await Promise.all([first, second]);
    expect(app.loadDocument).toHaveBeenCalledTimes(1);
    expect(app.documentId).toBe('doc-1');
  });

  it('does not show reconnect status before the delay', () => {
    jest.useFakeTimers();
    try {
      const app = new App();
      app.uiManager.documentOpenState = 'ready';
      const badge = document.getElementById('connectionBadge');

      app.handleWSStatusChange('reconnecting');
      jest.advanceTimersByTime(849);

      expect(badge.hidden).toBe(true);
      expect(badge.textContent).toBe('');

      jest.advanceTimersByTime(1);

      expect(badge.hidden).toBe(false);
      expect(badge.textContent).toBe('Reconnecting');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not flicker connecting status on quick connect', () => {
    jest.useFakeTimers();
    try {
      const app = new App();
      app.uiManager.documentOpenState = 'ready';
      const badge = document.getElementById('connectionBadge');

      app.handleWSStatusChange('connecting');
      jest.advanceTimersByTime(200);
      app.handleWSStatusChange('connected');
      jest.advanceTimersByTime(1000);

      expect(badge.hidden).toBe(false);
      expect(badge.textContent).toBe('Connected');
      expect(badge.dataset.status).toBe('connected');
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows retry and back actions for document open errors', async () => {
    const app = new App();
    await new Promise(process.nextTick);
    const retry = jest.fn();
    const back = jest.fn();

    app.uiManager.showDocumentOpenError({
      message: 'Open failed',
      onRetry: retry,
      onBack: back,
    });

    expect(document.getElementById('editorOpenError').hidden).toBe(false);
    expect(document.getElementById('editorOpenErrorMessage').textContent).toBe('Open failed');

    document.getElementById('editorOpenRetry').click();
    document.getElementById('editorOpenBack').click();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('cleanup cancels pending connection status timers', () => {
    jest.useFakeTimers();
    try {
      const app = new App();
      app.uiManager.documentOpenState = 'ready';
      const badge = document.getElementById('connectionBadge');

      app.handleWSStatusChange('reconnecting');
      app.uiManager.cleanupTimers();
      jest.advanceTimersByTime(1000);

      expect(badge.hidden).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('removes dashboard opening class and disabled attributes after success', async () => {
    const app = new App();
    await new Promise(process.nextTick);

    app.uiManager.applyViewState('opening-document');
    app.libraryManager.openLock = true;
    app.libraryManager.isTransitioning = true;
    app.editor = { isReadyForUser: () => true };

    // Simulate active opening item
    const card = document.getElementById('createNewDoc');
    card.classList.add('is-opening');

    // Trigger successful open completion
    app.finishDocumentOpen(app.loadDocumentToken);

    expect(app.libraryManager.openLock).toBe(false);
    expect(app.libraryManager.isTransitioning).toBe(false);
    expect(card.classList.contains('is-opening')).toBe(false);
    expect(document.body.dataset.viewState).toBe('editor-ready');
  });

  it('removes dashboard opening class and disabled attributes after failure', async () => {
    const app = new App();
    await new Promise(process.nextTick);

    app.uiManager.applyViewState('opening-document');
    app.libraryManager.openLock = true;
    app.libraryManager.isTransitioning = true;

    const card = document.getElementById('createNewDoc');
    card.classList.add('is-opening');

    // Trigger open failure
    app.showDocumentOpenError(app.loadDocumentToken, 'Failed');

    expect(app.libraryManager.openLock).toBe(false);
    expect(app.libraryManager.isTransitioning).toBe(false);
    expect(card.classList.contains('is-opening')).toBe(false);
    expect(document.body.dataset.viewState).toBe('editor-error');
  });

  it('fallback still works if View Transition API is disabled/unavailable', async () => {
    const app = new App();
    await new Promise(process.nextTick);

    await app.libraryManager.startEditorTransition();

    // Should run transition immediately
    expect(document.getElementById('docLibrary').classList.contains('view-visible')).toBe(false);
    expect(document.getElementById('libraryOverlay').classList.contains('view-visible')).toBe(
      false
    );
  });

  it('should initialize with booting view state', () => {
    const app = new App();
    expect(document.body.dataset.viewState).toBe('booting');
    expect(document.getElementById('bootLoader').style.display).toBe('flex');
  });

  it('should transition to dashboard if profile load succeeds and no document ID', async () => {
    const app = new App();
    await new Promise(process.nextTick);
    expect(document.body.dataset.viewState).toBe('dashboard');
    expect(document.getElementById('bootLoader').style.display).toBe('none');
  });

  it('should transition to opening-document if profile load succeeds and document ID is present', async () => {
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('doc-123'),
    }));
    const app = new App();
    // Synchronously it is in booting state
    expect(document.body.dataset.viewState).toBe('booting');

    await new Promise(process.nextTick);
    // After async tasks resolve, it has progressed past opening-document to editor-loading
    expect(document.body.dataset.viewState).toBe('editor-loading');
    expect(document.getElementById('bootLoader').style.display).toBe('none');
  });

  it('should transition to auth state if profile load fails', async () => {
    Profile.prototype.loadProfile = jest.fn().mockResolvedValue(null);
    const app = new App();
    await new Promise(process.nextTick);
    expect(document.body.dataset.viewState).toBe('auth');
    expect(document.getElementById('bootLoader').style.display).toBe('none');
  });

  // ─── Startup visibility tests ────────────────────────────────────────────────

  it('editor chrome (header, ribbon-tabs, main-workspace) is hidden during booting', () => {
    // The body starts as "booting" before async init resolves.
    // CSS display:none is enforced by the view-state attribute — we verify
    // applyViewState sets the correct attribute so the CSS selector fires.
    new App();
    // Synchronously the state must be 'booting'
    expect(document.body.dataset.viewState).toBe('booting');
    // Confirm boot loader is visible (flex) during booting
    expect(document.getElementById('bootLoader').style.display).toBe('flex');
  });

  it('editor chrome is hidden during dashboard state', async () => {
    // After a successful profile load with no doc param, state = dashboard.
    new App();
    await new Promise(process.nextTick);
    expect(document.body.dataset.viewState).toBe('dashboard');
    // bootLoader must be gone during dashboard
    expect(document.getElementById('bootLoader').style.display).toBe('none');
    // applyViewState must not be 'editor' or 'editor-ready'
    expect(document.body.dataset.viewState).not.toBe('editor');
    expect(document.body.dataset.viewState).not.toBe('editor-ready');
  });

  it('grey workspace skeleton (#editorSkeleton) is hidden during booting', () => {
    // Before JS sets any state, body starts as 'booting' (set in HTML).
    // The data-view-state attribute drives CSS display:none for #editorSkeleton.
    new App();
    expect(document.body.dataset.viewState).toBe('booting');
    // The skeleton element must NOT be shown during booting.
    // In JSDOM, CSS isn't rendered, but we can assert viewState is 'booting'
    // which the CSS rules use to hide #editorSkeleton.
    // Verify applyViewState does NOT change state to anything editor-like yet.
    expect(['booting']).toContain(document.body.dataset.viewState);
  });

  it('root URL never auto-opens stale last-opened document (no doc param)', async () => {
    // With no ?doc= in the URL, init must resolve to 'dashboard', never 'editor'.
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue(null),
    }));

    const app = new App();
    await new Promise(process.nextTick);

    // documentId must remain null — editor was never loaded
    expect(app.documentId).toBeNull();
    // State must be dashboard
    expect(document.body.dataset.viewState).toBe('dashboard');
    // Editor creation must not have been triggered
    expect(app.editor).toBeNull();
    // Library must be visible
    expect(document.getElementById('docLibrary').style.display).toBe('block');
  });

  it('direct document link shows opening state then editor (not dashboard first)', async () => {
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('doc-xyz'),
    }));

    const app = new App();
    // At construction, must be booting
    expect(document.body.dataset.viewState).toBe('booting');

    await new Promise(process.nextTick);
    await new Promise(process.nextTick);

    // After async resolution, must have progressed past booting
    expect(document.body.dataset.viewState).not.toBe('booting');
    // Must NOT have landed on dashboard
    expect(document.body.dataset.viewState).not.toBe('dashboard');
    // Library must be hidden since we went directly to a document
    expect(document.getElementById('docLibrary').style.display).toBe('none');
  });

  it('startup cleanup (clearOpeningStates) runs when finishDocumentOpen is called', async () => {
    const app = new App();
    await new Promise(process.nextTick);

    // Simulate an open in progress
    app.uiManager.applyViewState('opening-document');
    app.libraryManager.openLock = true;
    app.libraryManager.isTransitioning = true;
    app.editor = { isReadyForUser: () => true };

    app.finishDocumentOpen(app.loadDocumentToken);

    // openLock and isTransitioning must be cleared
    expect(app.libraryManager.openLock).toBe(false);
    expect(app.libraryManager.isTransitioning).toBe(false);
    // State must be editor-ready
    expect(document.body.dataset.viewState).toBe('editor-ready');
  });

  it('startup cleanup (clearOpeningStates) runs when showDocumentOpenError is called', async () => {
    const app = new App();
    await new Promise(process.nextTick);

    // Simulate an open in progress
    app.uiManager.applyViewState('opening-document');
    app.libraryManager.openLock = true;
    app.libraryManager.isTransitioning = true;

    app.showDocumentOpenError(app.loadDocumentToken, 'Something went wrong');

    // Locks cleared on failure
    expect(app.libraryManager.openLock).toBe(false);
    expect(app.libraryManager.isTransitioning).toBe(false);
    // State reflects error, not a stuck opening state
    expect(document.body.dataset.viewState).toBe('editor-error');
  });

  // ─── UX/Animation and Transition tests ──────────────────────────────────────────

  it('boot loader gets .fading-out class before it is hidden', () => {
    jest.useFakeTimers();
    try {
      window.matchMedia = jest.fn().mockReturnValue({
        matches: false, // Transitions enabled!
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      });

      const app = new App();

      // Force booting state first
      app.uiManager.applyViewState('booting');
      const bootLoader = document.getElementById('bootLoader');
      expect(bootLoader.style.display).toBe('flex');
      expect(bootLoader.classList.contains('fading-out')).toBe(false);

      // Transition away from booting
      app.uiManager.applyViewState('dashboard');
      expect(bootLoader.classList.contains('fading-out')).toBe(true);
      expect(bootLoader.style.display).toBe('flex'); // Still flex while fading out

      jest.advanceTimersByTime(200);
      expect(bootLoader.style.display).toBe('none');
    } finally {
      jest.useRealTimers();
    }
  });

  it('soft-reveal-enter and soft-reveal-ready classes are applied correctly to editor elements', () => {
    const app = new App();

    // Create dummy header/workspace elements since JSDOM might not have them unless they exist in setup
    document.body.innerHTML += `
      <div class="header"></div>
      <div class="ribbon-tabs"></div>
      <div class="ribbon-content"></div>
      <div class="main-workspace"></div>
    `;

    const header = document.querySelector('.header');

    // On opening-document
    app.uiManager.applyViewState('opening-document');
    expect(header.classList.contains('soft-reveal-enter')).toBe(true);
    expect(header.classList.contains('soft-reveal-ready')).toBe(false);

    // On editor-loading
    app.uiManager.applyViewState('editor-loading');
    expect(header.classList.contains('soft-reveal-enter')).toBe(false);
    expect(header.classList.contains('soft-reveal-ready')).toBe(true);

    // On back to dashboard, they should be cleaned up
    app.uiManager.applyViewState('dashboard');
    expect(header.classList.contains('soft-reveal-enter')).toBe(false);
    expect(header.classList.contains('soft-reveal-ready')).toBe(false);
  });

  it('view-exiting is applied to library during transition', async () => {
    jest.useFakeTimers();
    try {
      window.matchMedia = jest.fn().mockReturnValue({
        matches: false, // Enable motion to trigger timeout
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      });

      const app = new App();
      const library = document.getElementById('docLibrary');
      const overlay = document.getElementById('libraryOverlay');

      library.classList.add('view-visible');
      overlay.classList.add('view-visible');

      const transitionPromise = app.libraryManager.startEditorTransition();

      expect(library.classList.contains('view-exiting')).toBe(true);
      expect(overlay.classList.contains('view-exiting')).toBe(true);

      jest.advanceTimersByTime(180);
      await transitionPromise;

      expect(library.classList.contains('view-visible')).toBe(false);
      expect(library.classList.contains('view-exiting')).toBe(false);
      expect(library.style.display).toBe('none');
    } finally {
      jest.useRealTimers();
    }
  });

  it('pagesContainer state attribute control matches design', () => {
    const app = new App();

    app.uiManager.setDocumentOpenState('loading-document');
    expect(document.body.dataset.documentOpenState).toBe('loading-document');

    app.uiManager.setDocumentOpenState('ready');
    expect(document.body.dataset.documentOpenState).toBe('ready');
  });
});
