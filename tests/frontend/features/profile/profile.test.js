/**
 * @jest-environment jsdom
 */

import { Profile } from '/js/features/profile/profile.js';
import { Auth } from '/js/features/auth/auth.js';
import { Network } from '/js/app/network.js';

jest.mock('/js/features/auth/auth.js');
jest.mock('/js/app/network.js');

describe('Profile UI', () => {
  let profile;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <input id="profileEmailInput" />
      <input id="profileUsernameInput" />
      <textarea id="profileBioInput"></textarea>
      <div id="emailVerificationBadge"></div>
      <div id="verificationPrompt" style="display:none;">
        <button id="resendVerificationBtn" type="button"></button>
        <span id="resendTimer" style="display:none;"></span>
        <input id="verificationCodeInput" />
        <button id="verifyEmailBtn" type="button"></button>
        <div id="verificationStatusMessage"></div>
      </div>
      <img id="profilePfp" style="display:none;" />
      <div id="profileInitials" style="display:none;"></div>
      <div id="profilePfpPlaceholder"></div>
      <img id="headerPfp" style="display:none;" />
      <div id="headerInitials" style="display:none;"></div>
      <i id="headerUserIcon"></i>
      <img id="libraryHeaderPfp" style="display:none;" />
      <div id="libraryHeaderInitials" style="display:none;"></div>
      <i id="libraryHeaderUserIcon"></i>
      <i id="privacyToggle"></i>
    `;
    window.app = {
      user: null,
      handleEmailVerified: jest.fn(),
    };
    window.editor = undefined;
    profile = new Profile();
  });

  describe('getInitials', () => {
    it('should return initials for a single name', () => {
      expect(profile.getInitials('Jordan')).toBe('J');
    });

    it('should return initials for multiple names', () => {
      expect(profile.getInitials('Jordan Smith')).toBe('JS');
    });

    it('should return initials for more than two names (limited to 2)', () => {
      expect(profile.getInitials('Jordan Alexander Smith')).toBe('JA');
    });

    it('should return ? if name is missing', () => {
      expect(profile.getInitials('')).toBe('?');
      expect(profile.getInitials(null)).toBe('?');
    });
  });

  describe('loadProfile', () => {
    it('should show and hide skeleton during load', async () => {
      const mockUser = { username: 'testuser', email: 'test@example.com' };
      Auth.verifyToken.mockResolvedValue(mockUser);

      const promise = profile.loadProfile();

      // Check if skeleton classes are added
      expect(document.getElementById('profileEmailInput').classList.contains('skeleton')).toBe(
        true
      );
      expect(document.getElementById('profilePfpPlaceholder').classList.contains('skeleton')).toBe(
        true
      );

      await promise;

      // Check if skeleton classes are removed
      expect(document.getElementById('profileEmailInput').classList.contains('skeleton')).toBe(
        false
      );
      expect(document.getElementById('profilePfpPlaceholder').classList.contains('skeleton')).toBe(
        false
      );
    });
  });

  describe('updateUI', () => {
    it('should display initials fallback if no profile picture exists', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        accentColor: '#ff0000',
      };

      profile.updateUI();

      const initialsEl = document.getElementById('profileInitials');
      expect(initialsEl.style.display).toBe('flex');
      expect(initialsEl.textContent).toBe('JD');
      expect(initialsEl.style.backgroundColor).toBe('rgb(255, 0, 0)'); // Hex converted to RGB in JSDOM

      const pfpEl = document.getElementById('profilePfp');
      expect(pfpEl.style.display).toBe('none');
    });

    it('should display profile picture if it exists', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        profilePicture: 'data:image/png;base64,abc',
      };

      profile.updateUI();

      const pfpEl = document.getElementById('profilePfp');
      expect(pfpEl.style.display).toBe('block');
      expect(pfpEl.src).toBe('data:image/png;base64,abc');

      const initialsEl = document.getElementById('profileInitials');
      expect(initialsEl.style.display).toBe('none');
    });

    it('treats numeric 0 as unverified', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        emailVerified: true,
        isEmailVerified: 0,
      };

      profile.updateUI();

      expect(document.getElementById('emailVerificationBadge').textContent).toContain('Unverified');
      expect(document.getElementById('verificationPrompt').style.display).toBe('flex');
      expect(document.getElementById('resendVerificationBtn').textContent).toBe(
        'Send verification code'
      );
    });

    it('hides the verification prompt for verified users', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        emailVerified: true,
      };

      profile.updateUI();

      expect(document.getElementById('emailVerificationBadge').textContent).toContain('Verified');
      expect(document.getElementById('verificationPrompt').style.display).toBe('none');
    });
  });

  describe('verification actions', () => {
    beforeEach(() => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        emailVerified: false,
        isEmailVerified: false,
      };
      window.app.user = { ...profile.user };
      profile.updateUI();
    });

    it('shows a success message after sending a verification code', async () => {
      jest.useFakeTimers();
      Network.fetchAPI.mockResolvedValue({ ok: true });

      await profile.resendVerification();

      expect(Network.fetchAPI).toHaveBeenCalledWith('/api/auth/send-verification', {
        method: 'POST',
        body: JSON.stringify({ email: 'john@example.com', purpose: 'signup' }),
      });
      expect(document.getElementById('verificationStatusMessage').textContent).toBe(
        'Verification code sent. Check your email.'
      );
      expect(document.getElementById('verificationStatusMessage').className).toContain('success');
      expect(document.getElementById('resendVerificationBtn').textContent).toBe(
        'Resend verification code'
      );
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('shows the backend error message when sending a verification code fails', async () => {
      Network.fetchAPI.mockRejectedValue(new Error('Email delivery is not configured'));

      await profile.resendVerification();

      expect(document.getElementById('verificationStatusMessage').textContent).toBe(
        'Email delivery is not configured'
      );
      expect(document.getElementById('verificationStatusMessage').className).toContain('error');
    });

    it('updates the UI immediately after successful verification', async () => {
      Network.fetchAPI.mockResolvedValue({
        ok: true,
        emailVerified: true,
        isEmailVerified: true,
        message: 'Email verified.',
      });
      document.getElementById('verificationCodeInput').value = '123456';

      await profile.verifyEmail();

      expect(Network.fetchAPI).toHaveBeenCalledWith('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email: 'john@example.com', code: '123456', purpose: 'signup' }),
      });
      expect(profile.user.emailVerified).toBe(true);
      expect(document.getElementById('verificationPrompt').style.display).toBe('none');
      expect(document.getElementById('emailVerificationBadge').textContent).toContain('Verified');
      expect(window.app.handleEmailVerified).toHaveBeenCalled();
    });

    it('shows the backend error message when verification fails', async () => {
      Network.fetchAPI.mockRejectedValue(new Error('Invalid or expired verification code'));
      document.getElementById('verificationCodeInput').value = '123456';

      await profile.verifyEmail();

      expect(document.getElementById('verificationStatusMessage').textContent).toBe(
        'Invalid or expired verification code'
      );
      expect(document.getElementById('verificationStatusMessage').className).toContain('error');
      expect(document.getElementById('verificationPrompt').style.display).toBe('flex');
    });

    it('treats string 0 as unverified', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        emailVerified: true,
        isEmailVerified: '0',
      };

      profile.updateUI();

      expect(document.getElementById('emailVerificationBadge').textContent).toContain('Unverified');
      expect(document.getElementById('resendVerificationContainer').style.display).toBe('block');
    });

    it('treats missing isEmailVerified as unverified', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
      };

      profile.updateUI();

      expect(document.getElementById('emailVerificationBadge').textContent).toContain('Unverified');
      expect(document.getElementById('resendVerificationContainer').style.display).toBe('block');
    });

    it('shows verified only for strict true', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        isEmailVerified: true,
      };

      profile.updateUI();

      expect(document.getElementById('emailVerificationBadge').textContent).toContain('Verified');
      expect(document.getElementById('resendVerificationContainer').style.display).toBe('none');
    });

    it('shows verified for numeric 1', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        isEmailVerified: 1,
      };

      profile.updateUI();

      expect(document.getElementById('emailVerificationBadge').textContent).toContain('Verified');
      expect(document.getElementById('resendVerificationContainer').style.display).toBe('none');
    });
  });

  describe('loadProfile', () => {
    it('normalizes fetched verification state before storing it', async () => {
      const mockUser = {
        username: 'testuser',
        email: 'test@example.com',
        isEmailVerified: '0',
        emailVerified: true,
      };
      Auth.verifyToken.mockResolvedValue(mockUser);

      const loaded = await profile.loadProfile({ silent: true });

      expect(loaded.isEmailVerified).toBe(false);
      expect(loaded.emailVerified).toBe(false);
      expect(profile.user.isEmailVerified).toBe(false);
      expect(profile.user.emailVerified).toBe(false);
    });
  });
});
