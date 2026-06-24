/**
 * @jest-environment jsdom
 */

import { Profile } from '/js/features/profile/profile.js';
import { Auth } from '/js/features/auth/auth.js';

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
      <div id="resendVerificationContainer"></div>
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

    it('should render the verification badge from isEmailVerified', () => {
      profile.user = {
        username: 'John Doe',
        email: 'john@example.com',
        emailVerified: true,
        isEmailVerified: false,
      };

      profile.updateUI();

      expect(document.getElementById('emailVerificationBadge').textContent).toContain('Unverified');
      expect(document.getElementById('resendVerificationContainer').style.display).toBe('block');
    });
  });
});
