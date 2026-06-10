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
});
