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
      <div id="documentList"></div>
      <div id="activeCollaborators"></div>
      <div id="serverOfflineOverlay"></div>
      
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

  it('should not show connection overlay if page is hidden', async () => {
    jest.useFakeTimers();
    global.URLSearchParams = jest.fn(() => ({
      get: jest.fn().mockReturnValue('123'),
    }));

    // Mock hidden state
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });

    const app = new App();
    // Use runAllTicks instead of nextTick promise for fake timers
    jest.runAllTicks();

    const overlay = document.getElementById('serverOfflineOverlay');
    overlay.style.display = 'none';
    app.handleWSStatusChange('connecting');

    expect(overlay.style.display).toBe('none');

    // Change to visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    app.handleWSStatusChange('connecting');

    // Fast-forward 5 seconds
    jest.advanceTimersByTime(5000);

    expect(overlay.style.display).toBe('flex');
    jest.useRealTimers();
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
});
