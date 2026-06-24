/**
 * @jest-environment jsdom
 */

import { App } from '/js/app/app.js';
import { LibraryManager } from '/js/features/library/LibraryManager.js';
import { Network } from '/js/app/network.js';
import { Profile } from '/js/features/profile/profile.js';
import * as Utils from '/js/app/utils.js';

// Mocks
jest.mock('/js/app/network.js');
jest.mock('/js/features/auth/auth.js');
jest.mock('/js/features/ui/ui.js');
jest.mock('/js/features/editor/editor.js');
jest.mock('/js/features/theme/theme.js');
jest.mock('/js/features/theme/background.js');
jest.mock('/js/app/utils.js', () => ({
  ...jest.requireActual('/js/app/utils.js'),
  navigateTo: jest.fn(),
}));

describe('Unverified User Dashboard & Verification Handling', () => {
  const originalURLSearchParams = global.URLSearchParams;
  let originalConsoleError;
  let loadProfileSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    originalConsoleError = console.error;
    console.error = jest.fn();

    document.body.innerHTML = `
      <div id="bootLoader"></div>
      <div id="authGuard" style="display: none; opacity: 0;"></div>
      <div id="docLibrary"></div>
      <div id="libraryOverlay"></div>
      <button id="closeLibrary"></button>
      <div id="createNewDoc"></div>
      <input id="docSearch" />
      <div id="documentList"></div>
      <div id="profileModal" style="display: none;">
        <button id="tab-general"></button>
        <span id="emailVerificationBadge"></span>
        <div id="resendVerificationContainer" style="display: none;">
          <button id="resendVerificationBtn"></button>
          <span id="resendTimer"></span>
          <div id="profileVerifyCodeContainer" style="display: none;">
            <input id="profileVerificationCodeInput" />
            <button id="profileVerifyCodeBtn"></button>
          </div>
          <div id="profileVerificationMessage"></div>
        </div>
      </div>
    `;

    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });

    window.requestAnimationFrame = jest.fn().mockImplementation((cb) => cb());
  });

  afterEach(() => {
    console.error = originalConsoleError;
    if (loadProfileSpy) {
      loadProfileSpy.mockRestore();
    }
  });

  it('unverified authenticated user does not call the documents endpoint on dashboard boot and sees verification-required state', async () => {
    // Mock profile load to return an unverified authenticated user
    loadProfileSpy = jest.spyOn(Profile.prototype, 'loadProfile').mockResolvedValue({
      _id: 'user-unverified',
      username: 'UnverifiedUser',
      email: 'unverified@example.com',
      isEmailVerified: false
    });

    Network.getDocuments = jest.fn();

    const app = new App();
    await new Promise(process.nextTick);

    // Verify documents endpoint is not called
    expect(Network.getDocuments).not.toHaveBeenCalled();

    // Verify verification-required message is shown in documentList
    const listContainer = document.getElementById('documentList');
    expect(listContainer.innerHTML).toContain('Verify your email to access your documents.');

    // Verify profile modal is surfaced on boot
    const profileModal = document.getElementById('profileModal');
    expect(profileModal.style.display).toBe('flex');
  });

  it('EMAIL_VERIFICATION_REQUIRED error is handled without console error spam', async () => {
    // Set user to verified to allow getDocuments to run, but return verification-required error
    loadProfileSpy = jest.spyOn(Profile.prototype, 'loadProfile').mockResolvedValue({
      _id: 'user-1',
      username: 'User1',
      email: 'user@example.com',
      isEmailVerified: true
    });

    const error = new Error('Email verification required');
    error.code = 'EMAIL_VERIFICATION_REQUIRED';
    error.status = 403;
    Network.getDocuments = jest.fn().mockRejectedValue(error);

    const app = new App();
    await new Promise(process.nextTick);

    // console.error should NOT have been called with the network failure
    expect(console.error).not.toHaveBeenCalled();

    // Verify verification-required empty state is rendered
    const listContainer = document.getElementById('documentList');
    expect(listContainer.innerHTML).toContain('Verify your email to access your documents.');
  });

  it('verified user still loads documents normally', async () => {
    loadProfileSpy = jest.spyOn(Profile.prototype, 'loadProfile').mockResolvedValue({
      _id: 'user-verified',
      username: 'VerifiedUser',
      email: 'verified@example.com',
      isEmailVerified: true
    });

    Network.getDocuments = jest.fn().mockResolvedValue({ documents: [{ _id: 'doc1', title: 'Doc 1' }] });

    const app = new App();
    await new Promise(process.nextTick);

    // Verify documents endpoint is called
    expect(Network.getDocuments).toHaveBeenCalled();
  });

  it('after successful verification, library fetch runs normally', async () => {
    // Mock Profile load to return an unverified authenticated user
    const mockUser = {
      _id: 'user-unverified',
      username: 'UnverifiedUser',
      email: 'unverified@example.com',
      isEmailVerified: false
    };

    loadProfileSpy = jest.spyOn(Profile.prototype, 'loadProfile').mockImplementation(function() {
      this.user = mockUser;
      this.updateUI();
      return Promise.resolve(mockUser);
    });

    Network.fetchAPI = jest.fn().mockResolvedValue({ ok: true, message: 'Email verified.' });
    Network.getDocuments = jest.fn().mockResolvedValue({ documents: [{ _id: 'doc1', title: 'Doc 1' }] });

    const app = new App();
    await new Promise(process.nextTick);

    // Initial check: getDocuments not called yet
    expect(Network.getDocuments).not.toHaveBeenCalled();

    // Mock verification form input
    const codeInput = document.getElementById('profileVerificationCodeInput');
    codeInput.value = '123456';

    // Clear transitioning flag to allow showLibrary() to fetch documents
    app.libraryManager.isTransitioning = false;

    // Simulate verification submit by calling the async method directly
    await app.profile.verifyEmailCode();

    // Verify Network.fetchAPI was called to verify code
    expect(Network.fetchAPI).toHaveBeenCalledWith('/api/auth/verify-email', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'unverified@example.com', code: '123456', purpose: 'signup' })
    }));

    // Verify user verified state updated on frontend
    expect(app.user.isEmailVerified).toBe(true);

    // Verify documents endpoint is now called normally
    expect(Network.getDocuments).toHaveBeenCalled();
  });
});
