import { Auth } from '/js/features/auth/auth.js';
import { Network } from '/js/app/network.js';

export class Profile {
  constructor() {
    this.user = null;
    this.hasSentVerificationCode = false;
    this.resendCooldownInterval = null;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Password strength listener
    const newPasswordInput = document.getElementById('newPassword');
    if (newPasswordInput) {
      newPasswordInput.addEventListener('input', () =>
        this.updatePasswordStrength(newPasswordInput.value)
      );
    }

    // Tab switching listener (to load sessions when security tab is opened)
    const profileTabs = document.querySelectorAll('.profile-tab');
    profileTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.getAttribute('data-tab') === 'security') {
          this.loadSessions();
          this.loadLoginHistory();
        }
      });
    });

    // Resend verification listener
    const resendBtn = document.getElementById('resendVerificationBtn');
    if (resendBtn) {
      resendBtn.addEventListener('click', () => this.resendVerification());
    }

    const verifyBtn = document.getElementById('verifyEmailBtn');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', () => this.verifyEmail());
    }

    const verificationCodeInput = document.getElementById('verificationCodeInput');
    if (verificationCodeInput) {
      verificationCodeInput.addEventListener('input', () => {
        verificationCodeInput.value = verificationCodeInput.value.replace(/\D/g, '').slice(0, 6);
      });
      verificationCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.verifyEmail();
        }
      });
    }

    // Revoke all others listener
    const revokeOthersBtn = document.getElementById('revokeAllOthersBtn');
    if (revokeOthersBtn) {
      revokeOthersBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.revokeAllOtherSessions();
      });
    }

    // Privacy toggle listener
    const privacyToggle = document.getElementById('privacyToggle');
    if (privacyToggle) {
      privacyToggle.addEventListener('click', () => this.togglePrivacy());
      privacyToggle.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          this.togglePrivacy();
        }
      });
    }

    // PFP upload listener with validation
    const pfpInput = document.getElementById('pfpUpload');
    if (pfpInput) {
      pfpInput.addEventListener('change', (e) => this.handlePfpUpload(e));
    }

    // Collapsible sections
    this.setupCollapsible('toggleLoginHistory', 'loginHistoryContainer');
    this.setupCollapsible('toggleSessions', 'sessionListContainer');
  }

  setupCollapsible(headerId, containerId) {
    const header = document.getElementById(headerId);
    const container = document.getElementById(containerId);
    if (!header || !container) return;

    // Accessibility attributes
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', containerId);

    // Keyboard support
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        header.click();
      }
    });

    header.addEventListener('click', () => {
      const isHidden = container.style.display === 'none';
      container.style.display = isHidden
        ? containerId === 'sessionListContainer'
          ? 'flex'
          : 'block'
        : 'none';
      header.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
      const icon = header.querySelector('.accordion-chevron');
      if (icon) {
        icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });
  }

  async handlePfpUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Security: Max 1MB check
    if (file.size > 1024 * 1024) {
      alert('File too large! Maximum size is 1MB.');
      e.target.value = ''; // Reset input
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      await this.updateProfilePicture(event.target.result);
    };
    reader.readAsDataURL(file);
  }

  async togglePrivacy() {
    if (!this.user) return;
    const newState = !this.user.showOnlineStatus;

    try {
      const data = await Network.fetchAPI('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ showOnlineStatus: newState }),
      });

      this.user.showOnlineStatus = data.showOnlineStatus;
      this.updatePrivacyUI();

      // Notify editor if it exists
      if (window.editor) {
        window.editor.updateUser(this.user);
      }
    } catch (err) {
      console.error('Failed to toggle privacy:', err);
      alert('Failed to update privacy settings');
    }
  }

  updatePrivacyUI() {
    const toggle = document.getElementById('privacyToggle');
    if (!toggle) return;

    if (this.user.showOnlineStatus) {
      toggle.className = 'fas fa-toggle-on';
      toggle.style.color = 'var(--accent-color-light)';
      toggle.setAttribute('aria-checked', 'true');
    } else {
      toggle.className = 'fas fa-toggle-off';
      toggle.style.color = '#666';
      toggle.setAttribute('aria-checked', 'false');
    }
  }

  async loadProfile(options = {}) {
    const silent = typeof options === 'boolean' ? options : Boolean(options.silent);

    if (!silent) {
      this.showSkeleton();
    }

    const profile = await Auth.verifyToken();
    this.user = profile ? this.normalizeVerificationState(profile) : profile;

    if (!silent) {
      this.hideSkeleton();
    }

    if (this.user) {
      this.updateUI();
    }

    return this.user;
  }

  normalizeVerificationState(profile) {
    const isVerified =
      profile?.isEmailVerified === true || Number(profile?.isEmailVerified) === 1;

    return {
      ...profile,
      emailVerified: isVerified,
      isEmailVerified: isVerified,
    };
  }

  getInitials(name) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  showSkeleton() {
    const fields = ['profileEmailInput', 'profileUsernameInput', 'profileBioInput'];
    fields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('skeleton');
    });

    const pfpPlaceholder = document.getElementById('profilePfpPlaceholder');
    if (pfpPlaceholder) pfpPlaceholder.classList.add('skeleton', 'skeleton-circle');
  }

  hideSkeleton() {
    const fields = ['profileEmailInput', 'profileUsernameInput', 'profileBioInput'];
    fields.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('skeleton');
    });

    const pfpPlaceholder = document.getElementById('profilePfpPlaceholder');
    if (pfpPlaceholder) pfpPlaceholder.classList.remove('skeleton', 'skeleton-circle');
  }

  updateUI() {
    this.user = this.normalizeVerificationState(this.user || {});

    const profileEmailInput = document.getElementById('profileEmailInput');
    if (profileEmailInput) profileEmailInput.value = this.user.email;

    const profileUsernameInput = document.getElementById('profileUsernameInput');
    if (profileUsernameInput) profileUsernameInput.value = this.user.username;

    const profileBioInput = document.getElementById('profileBioInput');
    if (profileBioInput) profileBioInput.value = this.user.bio || '';

    this.updateVerificationBadge();
    this.updateVerificationPrompt();
    this.updatePrivacyUI();

    const pfpElements = [
      document.getElementById('profilePfp'),
      document.getElementById('headerPfp'),
      document.getElementById('libraryHeaderPfp'),
    ];
    const initialsElements = [
      document.getElementById('profileInitials'),
      document.getElementById('headerInitials'),
      document.getElementById('libraryHeaderInitials'),
    ];
    const iconElements = [
      document.getElementById('profilePfpPlaceholder'),
      document.getElementById('headerUserIcon'),
      document.getElementById('libraryHeaderUserIcon'),
    ];

    const initials = this.getInitials(this.user.username);
    const accentColor = this.user.accentColor || '#8b5cf6';

    if (this.user.profilePicture) {
      pfpElements.forEach((el) => {
        if (el) {
          el.src = this.user.profilePicture;
          el.style.display = 'block';
        }
      });
      initialsElements.forEach((el) => {
        if (el) el.style.display = 'none';
      });
      iconElements.forEach((el) => {
        if (el) el.style.display = 'none';
      });
    } else {
      pfpElements.forEach((el) => {
        if (el) el.style.display = 'none';
      });
      initialsElements.forEach((el) => {
        if (el) {
          el.textContent = initials;
          el.style.backgroundColor = accentColor;
          el.style.display = 'flex';
        }
      });
      iconElements.forEach((el) => {
        if (el) el.style.display = 'none';
      });
    }
  }

  updateVerificationBadge() {
    const badge = document.getElementById('emailVerificationBadge');
    if (!badge) return;

    const isVerified =
      this.user?.isEmailVerified === true || Number(this.user?.isEmailVerified) === 1;

    if (isVerified) {
      badge.innerHTML =
        '<span class="status-pill status-pill-verified"><i class="fas fa-check-circle"></i> Verified</span>';
    } else {
      badge.innerHTML =
        '<span class="status-pill status-pill-unverified"><i class="fas fa-exclamation-circle"></i> Unverified</span>';
    }
  }

  updateVerificationPrompt() {
    const prompt = document.getElementById('verificationPrompt');
    const resendBtn = document.getElementById('resendVerificationBtn');
    const codeInput = document.getElementById('verificationCodeInput');

    if (!prompt || !resendBtn || !codeInput) return;

    const isVerified = Boolean(this.user && this.user.emailVerified);
    prompt.style.display = isVerified ? 'none' : 'flex';
    resendBtn.textContent = this.hasSentVerificationCode
      ? 'Resend verification code'
      : 'Send verification code';

    if (isVerified) {
      this.setVerificationStatus('');
      codeInput.value = '';
      this.stopResendCooldown();
    }
  }

  setVerificationStatus(message, type = '') {
    const statusEl = document.getElementById('verificationStatusMessage');
    if (!statusEl) return;

    statusEl.textContent = message || '';
    statusEl.className = type ? `profile-inline-status ${type}` : 'profile-inline-status';
  }

  startResendCooldown(seconds = 30) {
    const resendBtn = document.getElementById('resendVerificationBtn');
    const timerSpan = document.getElementById('resendTimer');
    if (!resendBtn || !timerSpan) return;

    this.stopResendCooldown();
    let remaining = seconds;
    resendBtn.disabled = true;
    timerSpan.style.display = 'inline';
    timerSpan.textContent = `Resend available in ${remaining}s`;

    this.resendCooldownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        this.stopResendCooldown();
        return;
      }
      timerSpan.textContent = `Resend available in ${remaining}s`;
    }, 1000);
  }

  stopResendCooldown() {
    const resendBtn = document.getElementById('resendVerificationBtn');
    const timerSpan = document.getElementById('resendTimer');

    if (this.resendCooldownInterval) {
      clearInterval(this.resendCooldownInterval);
      this.resendCooldownInterval = null;
    }

    if (resendBtn) {
      resendBtn.disabled = false;
    }

    if (timerSpan) {
      timerSpan.style.display = 'none';
      timerSpan.textContent = '';
    }
  }

  async resendVerification() {
    const resendBtn = document.getElementById('resendVerificationBtn');
    if (!resendBtn || !this.user) return;

    try {
      this.setVerificationStatus('Sending verification code...');
      resendBtn.disabled = true;
      await Network.fetchAPI('/api/auth/send-verification', {
        method: 'POST',
        body: JSON.stringify({ email: this.user.email, purpose: 'signup' }),
      });
      this.hasSentVerificationCode = true;
      this.updateVerificationPrompt();
      this.setVerificationStatus('Verification code sent. Check your email.', 'success');
      this.startResendCooldown();
    } catch (err) {
      console.error('Resend error:', err);
      this.stopResendCooldown();
      this.setVerificationStatus(
        err.message || 'Failed to send verification code. Please try again.',
        'error'
      );
    }
  }

  async verifyEmail() {
    const verifyBtn = document.getElementById('verifyEmailBtn');
    const codeInput = document.getElementById('verificationCodeInput');

    if (!verifyBtn || !codeInput || !this.user) return;

    const code = codeInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      this.setVerificationStatus('Verification code must be 6 digits.', 'error');
      codeInput.focus();
      return;
    }

    try {
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying...';
      this.setVerificationStatus('Verifying email...');

      const data = await Network.fetchAPI('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email: this.user.email, code, purpose: 'signup' }),
      });

      this.user.emailVerified = true;
      this.user.isEmailVerified = true;
      this.user.email_verified_at = this.user.email_verified_at || Math.floor(Date.now() / 1000);
      this.hasSentVerificationCode = false;
      this.updateUI();
      this.setVerificationStatus(data.message || 'Email verified.', 'success');
      codeInput.value = '';

      if (window.app) {
        window.app.user = {
          ...(window.app.user || {}),
          emailVerified: true,
          isEmailVerified: true,
          email_verified_at: this.user.email_verified_at,
        };
        if (typeof window.app.handleEmailVerified === 'function') {
          window.app.handleEmailVerified();
        }
      }

      if (window.editor && typeof window.editor.updateUser === 'function') {
        window.editor.updateUser(this.user);
      }
    } catch (err) {
      console.error('Verify email error:', err);
      this.setVerificationStatus(
        err.message || 'Invalid or expired verification code.',
        'error'
      );
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify email';
    }
  }

  updatePasswordStrength(password) {
    const bar = document.getElementById('passwordStrengthBar');
    const reqs = {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      symbol: /[!@#$%^&*]/.test(password),
    };

    let score = 0;
    Object.keys(reqs).forEach((key) => {
      const el = document.querySelector(`li[data-req="${key}"]`);
      if (reqs[key]) {
        score++;
        el.style.color = '#10b981';
        el.querySelector('i').className = 'fas fa-check-circle';
      } else {
        el.style.color = document.body.classList.contains('light-theme') ? '#4b5563' : '#666';
        el.querySelector('i').className = 'fas fa-circle';
      }
    });

    const colors = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'];
    const widths = ['25%', '50%', '75%', '100%'];

    if (password.length === 0) {
      bar.style.width = '0%';
    } else {
      const index = Math.min(score, colors.length) - 1;
      bar.style.width = widths[index] || '0%';
      bar.style.background = colors[index] || '#ef4444';
    }
  }

  async loadSessions() {
    const container = document.getElementById('sessionListContainer');
    if (!container) return;

    try {
      container.innerHTML =
        '<div style="font-size: 11px; color: #666; text-align: center; padding: 10px;">Loading sessions...</div>';
      const sessions = await Network.fetchAPI('/api/user/sessions');

      container.innerHTML = '';
      sessions
        .sort((a, b) => {
          if (a.isCurrent) return -1;
          if (b.isCurrent) return 1;
          return 0;
        })
        .forEach((session) => {
          const sessionEl = document.createElement('div');
          sessionEl.className = 'session-item';
          sessionEl.style.cssText =
            'padding: 12px; border-radius: 6px; border: 1px solid #2a2a2a; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;';

          const info = this.parseUserAgent(session.userAgent);
          const lastActive = this.formatLastActive(session.lastActive);

          sessionEl.innerHTML = `
                  <div style="flex: 1;">
                      <div style="display: flex; align-items: center; gap: 6px;">
                          <span class="session-info-main" style="font-size: 11px; font-weight: 600;">${info.os} • ${info.browser}</span>
                          ${session.isCurrent ? '<span style="font-size: 8px; background: var(--accent-color); color: white; padding: 1px 4px; border-radius: 4px; text-transform: uppercase;">Current</span>' : ''}
                      </div>
                      <div style="font-size: 10px; color: #666; margin-top: 2px;">${session.ipAddress} • ${lastActive}</div>
                  </div>
                  ${!session.isCurrent ? `<button class="revoke-session-btn" data-id="${session.sessionId}" style="background: none; border: none; color: #ef4444; font-size: 14px; cursor: pointer; padding: 4px;"><i class="fas fa-times-circle"></i></button>` : ''}
              `;
          container.appendChild(sessionEl);
        });

      // Add revocation listeners
      container.querySelectorAll('.revoke-session-btn').forEach((btn) => {
        btn.addEventListener('click', () => this.revokeSession(btn.getAttribute('data-id')));
      });
    } catch (err) {
      console.error('Error loading sessions:', err);
      container.innerHTML =
        '<div style="font-size: 11px; color: #ef4444; text-align: center; padding: 10px;">Failed to load sessions</div>';
    }
  }

  async loadLoginHistory() {
    const tbody = document.getElementById('loginHistoryTableBody');
    if (!tbody || !this.user.loginHistory) return;

    tbody.innerHTML = '';
    if (this.user.loginHistory.length === 0) {
      tbody.innerHTML =
        '<tr><td style="padding: 12px; color: #666; text-align: center;">No login history available</td></tr>';
      return;
    }

    this.user.loginHistory.forEach((timestamp, index) => {
      const date = new Date(timestamp);
      const row = document.createElement('tr');
      row.style.borderBottom =
        index === this.user.loginHistory.length - 1 ? 'none' : '1px solid rgba(139, 92, 246, 0.1)';

      row.innerHTML = `
              <td style="padding: 10px 12px;" class="history-item-cell">
                  <div style="display: flex; align-items: center; gap: 8px;">
                      <i class="fas fa-sign-in-alt" style="color: #666; font-size: 10px;"></i>
                      <span class="history-date-text">${date.toLocaleDateString()} at ${date.toLocaleTimeString()}</span>
                  </div>
              </td>
              <td style="padding: 10px 12px; color: #666; text-align: right;">
                  ${index === 0 ? '<span style="color: var(--accent-color-light); font-weight: 600; font-size: 8px; text-transform: uppercase;">Most Recent</span>' : ''}
              </td>
          `;
      tbody.appendChild(row);
    });
  }

  promptIdentityConfirmation() {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmIdentityModal');
      const input = document.getElementById('confirmIdentityPassword');
      const submitBtn = document.getElementById('submitConfirmIdentity');
      const cancelBtn = document.getElementById('cancelConfirmIdentity');

      if (!modal || !input || !submitBtn || !cancelBtn) {
        return resolve(null);
      }

      modal.style.display = 'flex';
      input.value = '';
      input.focus();

      const handleConfirm = () => {
        const password = input.value;
        if (!password) return;
        cleanup();
        resolve(password);
      };

      const handleCancel = () => {
        cleanup();
        resolve(null);
      };

      const handleKeydown = (e) => {
        if (e.key === 'Enter') handleConfirm();
        if (e.key === 'Escape') handleCancel();
      };

      const cleanup = () => {
        modal.style.display = 'none';
        submitBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        input.removeEventListener('keydown', handleKeydown);
      };

      submitBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      input.addEventListener('keydown', handleKeydown);
    });
  }

  async revokeSession(sessionId) {
    if (!confirm('Are you sure you want to revoke this session? The device will be signed out.'))
      return;
    try {
      await Network.fetchAPI(`/api/user/sessions/${sessionId}`, { method: 'DELETE' });
      this.loadSessions();
    } catch {
      alert('Failed to revoke session');
    }
  }

  async revokeAllOtherSessions() {
    if (!confirm('Sign out of all other devices?')) return;
    try {
      await Network.fetchAPI('/api/user/sessions', { method: 'DELETE' });
      this.loadSessions();
    } catch {
      alert('Failed to revoke sessions');
    }
  }

  parseUserAgent(ua) {
    let os = 'Unknown OS';
    let browser = 'Unknown Browser';

    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('like Mac')) os = 'iOS';

    if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Edge')) browser = 'Edge';

    return { os, browser };
  }

  formatLastActive(date) {
    const now = new Date();
    const last = new Date(date);
    const diffMs = now - last;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return last.toLocaleDateString();
  }

  async updateProfilePicture(base64String) {
    try {
      const data = await Network.fetchAPI('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ profilePicture: base64String }),
      });
      this.user.profilePicture = data.profilePicture;
      this.updateUI();
      if (window.editor) window.editor.updateUser(this.user);
      alert('Profile picture updated!');
    } catch (err) {
      console.error('Error updating PFP:', err);
      alert('Failed to update profile picture');
    }
  }

  async updateBio(bio) {
    try {
      const data = await Network.fetchAPI('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ bio }),
      });
      this.user.bio = data.bio;
      alert('Profile info updated!');
    } catch (err) {
      console.error('Error updating bio:', err);
      alert('Failed to update profile info');
    }
  }

  async updatePassword(currentPassword, newPassword) {
    try {
      await Network.fetchAPI('/api/user/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      alert('Password updated successfully!');
      return true;
    } catch (err) {
      console.error('Error updating password:', err);
      alert('Failed to update password');
      return false;
    }
  }

  async updateAccentColor(color) {
    if (!this.user) return;

    // UI Update is immediate
    this.user.accentColor = color;
    this.updateUI();
    if (window.editor) window.editor.updateUser(this.user);

    // Backend sync is debounced to prevent 429 Rate Limiting
    if (this.colorDebounceTimeout) clearTimeout(this.colorDebounceTimeout);
    this.colorDebounceTimeout = setTimeout(async () => {
      try {
        await Network.fetchAPI('/api/user/profile', {
          method: 'PUT',
          body: JSON.stringify({ accentColor: color }),
        });
        console.log(`[Profile] Accent color synced to backend: ${color}`);
      } catch (err) {
        console.error('Error syncing accent color:', err);
      }
    }, 1000); // 1-second debounce
  }
}
