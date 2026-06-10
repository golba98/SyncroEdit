/**
 * @jest-environment jsdom
 */

import { App } from '/js/app/app.js';
import { Network } from '/js/app/network.js';
import { Profile } from '/js/features/profile/profile.js';
import { Editor } from '/js/features/editor/editor.js';
import * as Utils from '/js/app/utils.js';

jest.mock('/js/app/network.js');
jest.mock('/js/features/auth/auth.js');
jest.mock('/js/features/ui/ui.js');
jest.mock('/js/features/theme/theme.js');
jest.mock('/js/features/profile/profile.js');
jest.mock('/js/features/theme/background.js');
jest.mock('/js/features/editor/editor.js', () => ({
  Editor: jest.fn(),
}));
jest.mock('/js/app/utils.js', () => ({
  ...jest.requireActual('/js/app/utils.js'),
  navigateTo: jest.fn(),
}));

describe('App Core Initialization', () => {
  const originalURLSearchParams = global.URLSearchParams;
  let editorInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="authGuard" style="display: none; opacity: 0;"></div>
      <div id="authGuardText"></div>
      <div id="docLibrary"></div>
      <div id="libraryOverlay"></div>
      <button id="closeLibrary"></button>
      <div id="documentList"></div>
      <div id="activeCollaborators"></div>
      <div id="serverOfflineOverlay"></div>
      <div id="editorShell"></div>
      <div id="editorSkeleton" class="hidden"></div>
      <div id="editorOpenError" hidden></div>
      <div id="editorOpenErrorMessage"></div>
      <button id="editorOpenRetry"></button>
      <div id="connectionBadge" hidden></div>
      <input id="docTitle" />
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

    Profile.prototype.loadProfile = jest
      .fn()
      .mockResolvedValue({ _id: 'user1', username: 'TestUser' });

    Network.getDocuments.mockResolvedValue({ documents: [] });
    Network.addToRecent.mockResolvedValue({});
    Network.getDocumentSnapshot.mockResolvedValue({
      _id: '123',
      title: 'Test document',
      yjsState: 'dGVzdA==',
      pageContent: '',
    });

    editorInstance = {
      currentDocId: '123',
      quill: { focus: jest.fn() },
      loadFromCache: jest.fn().mockResolvedValue(false),
      applySnapshot: jest.fn().mockResolvedValue(true),
      hasRenderableContent: jest.fn().mockReturnValue(true),
      connectWebSocket: jest.fn().mockResolvedValue(),
      destroy: jest.fn(),
    };
    Editor.mockImplementation(() => editorInstance);

    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue(null),
    }));

    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
  });

  afterAll(() => {
    global.URLSearchParams = originalURLSearchParams;
  });

  it('should show library if no document ID in URL', async () => {
    new App();
    await new Promise(process.nextTick);

    expect(Profile.prototype.loadProfile).toHaveBeenCalledWith({
      silent: true,
    });
    expect(document.body.dataset.viewState).toBe('dashboard');
    expect(Network.getDocuments).toHaveBeenCalled();
  });

  it('should load document if document ID is present', async () => {
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('123'),
    }));

    const app = new App();
    await new Promise(process.nextTick);
    await app.openPromise;

    expect(Network.addToRecent).toHaveBeenCalledWith('123');
    expect(Network.getDocumentSnapshot).toHaveBeenCalledWith('123');
    expect(editorInstance.loadFromCache).toHaveBeenCalledWith('123');
    expect(editorInstance.applySnapshot).toHaveBeenCalled();
    expect(editorInstance.connectWebSocket).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({ username: 'TestUser' })
    );
    expect(document.body.dataset.viewState).toBe('editor-ready');
  });

  it('should redirect to login if profile load fails', async () => {
    Profile.prototype.loadProfile = jest.fn().mockResolvedValue(null);

    new App();
    await new Promise(process.nextTick);

    expect(Utils.navigateTo).toHaveBeenCalledWith('pages/login.html');
  });

  it('should preserve doc param when redirecting after failed session check', async () => {
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('doc-42'),
    }));
    Profile.prototype.loadProfile = jest.fn().mockResolvedValue(null);

    new App();
    await new Promise(process.nextTick);

    expect(Utils.navigateTo).toHaveBeenCalledWith('pages/login.html?doc=doc-42');
  });

  it('should update the non-blocking connection badge', async () => {
    const app = new App();
    await new Promise(process.nextTick);

    const badge = document.getElementById('connectionBadge');
    app.handleWSStatusChange('connecting');

    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('Connecting...');
    expect(badge.dataset.status).toBe('connecting');
  });

  it('should dedupe repeated opens for the same document', async () => {
    const app = new App();
    await new Promise(process.nextTick);

    const firstPromise = app.openDocument('123');
    const secondPromise = app.openDocument('123');
    await firstPromise;
    await secondPromise;

    expect(Editor).toHaveBeenCalledTimes(1);
    expect(editorInstance.loadFromCache).toHaveBeenCalledTimes(1);
  });

  it('should recheck session silently when tab becomes visible', async () => {
    new App();
    await new Promise(process.nextTick);

    Profile.prototype.loadProfile.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(process.nextTick);

    expect(Profile.prototype.loadProfile).toHaveBeenCalledWith({
      silent: true,
    });
  });
});
