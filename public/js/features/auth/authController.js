/**
 * Authentication Controller
 * Manages login/signup forms and integrates with SynchroBot
 */
import { SynchroBot } from './synchro/SynchroBot.js';
import { Auth } from '/js/features/auth/auth.js';
import { Network } from '/js/app/network.js';
import { PASSWORD_REGEX } from '/js/app/utils.js';

class AuthController {
  constructor() {
    this.synchro = null;
    this.currentForm = 'login';
    this.init();
  }

  init() {
    // Determine which auth flow we're in based on the page
    const pageTitle = document.title;
    let authFlow = 'login';

    if (pageTitle.includes('Forgot')) {
      authFlow = 'forgot';
    } else if (pageTitle.includes('Reset')) {
      authFlow = 'reset';
    } else if (pageTitle.includes('Verify')) {
      authFlow = 'verify';
    } else if (pageTitle.includes('Start')) {
      authFlow = 'start';
    }

    // Initialize SynchroBot
    this.synchro = new SynchroBot({ authFlow });
    this.synchro.init('.character-container');

    // Setup form event listeners
    this.setupFormListeners();
  }

  setupFormListeners() {
    // Get all input fields
    const inputs = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="password"]'
    );

    inputs.forEach((input) => {
      // Focus events
      input.addEventListener('focus', (e) => {
        const fieldName = this.getFieldName(e.target);
        this.synchro.onFieldFocus(fieldName, e.target.value);
      });

      // Blur events
      input.addEventListener('blur', () => {
        this.synchro.onFieldBlur();
      });

      // Input events
      input.addEventListener('input', (e) => {
        const fieldName = this.getFieldName(e.target);
        const validation = this.validateField(e.target);
        this.synchro.onFieldInput(fieldName, e.target.value, validation);
        this.updateFormCompleteness();
        if (e.target.id === 'signupPassword') {
          this._updatePasswordStrength(e.target.value);
        }
      });
    });

    // Password visibility toggles
    const toggleButtons = document.querySelectorAll(
      '.password-toggle, .toggle-password, [data-toggle-password]'
    );
    toggleButtons.forEach((button) => {
      button.addEventListener('click', (e) => {
        // Find the closest input-wrapper or input-group
        const wrapper = e.target.closest('.input-wrapper') || e.target.closest('.input-group');
        const input = wrapper?.querySelector('input[type="password"], input[type="text"]');

        if (input && input.id?.toLowerCase().includes('password')) {
          const isCurrentlyPassword = input.type === 'password';
          input.type = isCurrentlyPassword ? 'text' : 'password';

          // Update icon
          const icon = button.querySelector('i');
          if (icon) {
            icon.className = isCurrentlyPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
          }

          this.synchro.onPasswordToggle(isCurrentlyPassword);
        }
      });
    });

    // Submit buttons
    const submitButtons = document.querySelectorAll(
      'button[type="submit"], .login-btn, #loginBtn, #signupBtn'
    );
    submitButtons.forEach((button) => {
      button.addEventListener('mouseenter', () => {
        this.synchro.onButtonHover(true);
      });

      button.addEventListener('mouseleave', () => {
        this.synchro.onButtonHover(false);
      });

      button.addEventListener('click', (e) => {
        const form =
          e.target.closest('form') ||
          e.target.closest('.form-section') ||
          e.target.closest('.form-container');
        if (form) {
          e.preventDefault();
          this.handleSubmit(form);
        }
      });
    });

    // Form toggle (login <-> signup)
    const showSignup = document.getElementById('showSignup');
    const showLogin = document.getElementById('showLogin');
    const signupBackBtn = document.getElementById('signupBackBtn');

    if (showSignup) {
      showSignup.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleForm('signup');
      });
    }

    if (showLogin) {
      showLogin.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleForm('login');
      });
    }

    if (signupBackBtn) {
      signupBackBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleForm('login');
      });
    }
  }

  getFieldName(input) {
    // Try to get a meaningful field name for synchro tracking
    if (input.id) {
      const id = input.id.toLowerCase();
      if (id.includes('password')) return 'password';
      if (id.includes('email') || id.includes('username')) return 'username';
    }
    if (input.type === 'password') return 'password';
    if (input.type === 'email') return 'username';
    return input.name || input.id || 'text';
  }

  validateField(input) {
    // Basic validation
    const value = input.value;
    const type = input.type;

    if (type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return { isValid: emailRegex.test(value), message: 'Invalid email' };
    }

    if (type === 'password' || input.id?.toLowerCase().includes('password')) {
      return { isValid: value.length >= 8, message: 'Password too short' };
    }

    return { isValid: value.length > 0 };
  }

  updateFormCompleteness() {
    // Check if all required fields are filled
    const currentFormSection =
      this.currentForm === 'login'
        ? document.getElementById('loginForm')
        : document.getElementById('signupForm');

    if (!currentFormSection) return;

    const requiredInputs = Array.from(
      currentFormSection.querySelectorAll(
        'input[required], input[type="email"], input[type="password"]'
      )
    );
    const allFilled = requiredInputs.every((input) => input.value.length > 0);
    const allValid = requiredInputs.every((input) => {
      const validation = this.validateField(input);
      return validation.isValid !== false;
    });

    if (allFilled && allValid) {
      this.synchro.formCompleteness = 'valid';
    } else if (allFilled) {
      this.synchro.formCompleteness = 'partial';
    } else if (requiredInputs.some((input) => input.value.length > 0)) {
      this.synchro.formCompleteness = 'partial';
    } else {
      this.synchro.formCompleteness = 'empty';
    }
  }

  toggleForm(formType) {
    this.currentForm = formType;
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    if (formType === 'signup') {
      loginForm?.classList.remove('active');
      signupForm?.classList.add('active');
      this._clearFormInputs(loginForm);
    } else {
      signupForm?.classList.remove('active');
      loginForm?.classList.add('active');
      this._clearFormInputs(signupForm);
    }

    this._clearAuthMessages();
    this._resetPasswordStrengthUI();
    this._resetPasswordVisibility();

    this.synchro.formCompleteness = 'empty';
    this.synchro.applyState('idle');

    // Clear stale status messages on both forms
    const loginStatus = document.getElementById('loginStatusMessage');
    const signupStatus = document.getElementById('signupStatusMessage');
    if (loginStatus) {
      loginStatus.textContent = '';
      loginStatus.className = 'status-message';
    }
    if (signupStatus) {
      signupStatus.textContent = '';
      signupStatus.className = 'status-message';
    }
  }

  _clearAuthMessages() {
    const statusMessages = document.querySelectorAll('.status-message');
    statusMessages.forEach((msg) => {
      msg.textContent = '';
      msg.className = 'status-message';
    });
  }

  _resetPasswordStrengthUI() {
    this._updatePasswordStrength('');
  }

  _resetPasswordVisibility() {
    const inputs = document.querySelectorAll('input[type="text"], input[type="password"]');
    inputs.forEach((input) => {
      if (input.id?.toLowerCase().includes('password')) {
        input.type = 'password';
      }
    });

    const toggleIcons = document.querySelectorAll('.password-toggle i, .toggle-password i');
    toggleIcons.forEach((icon) => {
      icon.className = 'fas fa-eye';
    });
  }

  _clearFormInputs(form) {
    if (!form) return;
    const inputs = form.querySelectorAll('input');
    inputs.forEach((input) => {
      input.value = '';
    });
  }

  async handleSubmit(form) {
    this.synchro.onSubmit();
    if (form.id === 'signupForm') {
      await this._handleSignup(form);
    } else {
      await this._handleLogin(form);
    }
  }

  async _handleLogin(form) {
    const username = form.querySelector('#loginUsername')?.value?.trim();
    const password = form.querySelector('#loginPassword')?.value;
    const statusEl = document.getElementById('loginStatusMessage');

    if (statusEl) statusEl.textContent = '';

    try {
      const data = await Network.fetchAPI('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      Auth.setToken(data.token);
      this.synchro.onSuccess();
      this._redirect();
    } catch (e) {
      const msg = e.message?.includes('401')
        ? 'Invalid username or password'
        : e.message?.replace('API error: ', '') || 'Login failed';
      if (statusEl) statusEl.textContent = msg;
      this.synchro.onError();
      setTimeout(() => this.synchro.applyState('idle'), 2000);
    }
  }

  async _handleSignup(form) {
    const username = form.querySelector('#signupUsername')?.value?.trim();
    const email = form.querySelector('#signupEmail')?.value?.trim();
    const password = form.querySelector('#signupPassword')?.value;
    const confirmPassword = form.querySelector('#signupPasswordConfirm')?.value;
    const statusEl = document.getElementById('signupStatusMessage');
    const btn = document.getElementById('signupBtn');

    const showError = (msg) => {
      if (statusEl) {
        statusEl.textContent = '✗ ' + msg;
        statusEl.className = 'status-message error';
      }
      this.synchro.onError();
      setTimeout(() => this.synchro.applyState('idle'), 2000);
    };

    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'status-message';
    }

    // Client-side validation
    if (!username || !email || !password || !confirmPassword) {
      return showError('Please fill in all fields.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return showError('Please enter a valid email address.');
    }

    if (!PASSWORD_REGEX.test(password)) {
      return showError('Password must be 8+ chars with uppercase, lowercase, number, and symbol.');
    }

    if (password !== confirmPassword) {
      return showError('Passwords do not match.');
    }

    // Loading state
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating account...';
    }

    try {
      const data = await Network.fetchAPI('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ username, email, password }),
      });

      if (data.token) {
        // Email verification disabled — log the user in directly
        Auth.setToken(data.token);
        this.synchro.onSuccess();
        if (statusEl) {
          statusEl.textContent = '✓ Account created! Redirecting...';
          statusEl.className = 'status-message success';
        }
        setTimeout(() => this._redirect(), 1500);
      } else {
        // Email verification enabled — show the verification modal
        this.synchro.onSuccess();
        if (statusEl) {
          statusEl.textContent =
            '✓ ' + (data.message || 'Check your email for a verification code.');
          statusEl.className = 'status-message success';
        }
        this._showVerificationModal(email);
      }
    } catch (e) {
      showError(e.message || 'Signup failed. Please try again.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    }
  }

  _showVerificationModal(email) {
    const modal = document.getElementById('emailVerificationModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const verifyBtn = document.getElementById('verifyCodeBtn');
    const resendBtn = document.getElementById('resendCodeBtn');
    const verificationMsg = document.getElementById('verificationMessage');
    const codeInput = document.getElementById('verificationCode');

    if (verifyBtn) {
      verifyBtn.onclick = async () => {
        const code = codeInput?.value?.trim();
        if (!code) {
          if (verificationMsg) {
            verificationMsg.textContent = 'Please enter the code.';
            verificationMsg.style.color = '#f44336';
          }
          return;
        }
        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying...';
        try {
          const data = await Network.fetchAPI('/api/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ email, verificationCode: code }),
          });
          Auth.setToken(data.token);
          if (verificationMsg) {
            verificationMsg.textContent = '✓ Email verified! Redirecting...';
            verificationMsg.style.color = '#4caf50';
          }
          this.synchro.onSuccess();
          setTimeout(() => this._redirect(), 1200);
        } catch (err) {
          if (verificationMsg) {
            verificationMsg.textContent = '✗ ' + (err.message || 'Invalid code.');
            verificationMsg.style.color = '#f44336';
          }
          verifyBtn.disabled = false;
          verifyBtn.textContent = 'Verify Code';
        }
      };
    }

    if (resendBtn) {
      resendBtn.onclick = async () => {
        resendBtn.disabled = true;
        try {
          await Network.fetchAPI('/api/auth/resend-code', {
            method: 'POST',
            body: JSON.stringify({ email }),
          });
          if (verificationMsg) {
            verificationMsg.textContent = 'New code sent to your email.';
            verificationMsg.style.color = '#4caf50';
          }
        } catch (err) {
          if (verificationMsg) {
            verificationMsg.textContent = '✗ ' + (err.message || 'Failed to resend.');
            verificationMsg.style.color = '#f44336';
          }
        } finally {
          resendBtn.disabled = false;
        }
      };
    }
  }

  _updatePasswordStrength(password) {
    const segment = document.getElementById('entropySegment');
    const label = document.getElementById('strengthLabel');
    if (!segment) return;

    const reqs = {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      symbol: /[!@#$%^&*]/.test(password),
    };

    let score = 0;
    for (const key of Object.keys(reqs)) {
      const el = document.querySelector(`.requirement-item[data-req="${key}"]`);
      if (!el) continue;
      if (reqs[key]) {
        score++;
        el.classList.add('met');
        el.querySelector('i').className = 'fas fa-check-circle';
      } else {
        el.classList.remove('met');
        el.querySelector('i').className = 'fas fa-circle';
      }
    }

    if (password.length === 0) {
      segment.style.width = '0%';
      segment.className = 'entropy-segment';
      if (label) {
        label.textContent = '';
        label.className = 'strength-label';
      }
      return;
    }

    const levels = [
      { minScore: 1, maxScore: 2, cls: 'entropy-weak', width: '30%', text: 'Weak' },
      { minScore: 3, maxScore: 3, cls: 'entropy-fair', width: '60%', text: 'Fair' },
      { minScore: 4, maxScore: 4, cls: 'entropy-strong', width: '80%', text: 'Strong' },
      { minScore: 5, maxScore: 5, cls: 'entropy-elite', width: '100%', text: 'Very Strong' },
    ];
    const level = levels.find((l) => score >= l.minScore && score <= l.maxScore) || levels[0];

    segment.style.width = level.width;
    segment.className = `entropy-segment ${level.cls}`;

    if (label) {
      label.textContent = level.text;
      label.className = `strength-label strength-label--${level.cls.replace('entropy-', '')}`;
    }
  }

  _redirect() {
    const overlay = document.getElementById('redirectOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      setTimeout(() => (overlay.style.opacity = '1'), 10);
    }
    const docId = new URLSearchParams(window.location.search).get('doc');
    setTimeout(() => {
      window.location.href = docId ? `/?doc=${docId}` : '/';
    }, 1500);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new AuthController();
  });
} else {
  new AuthController();
}

export default AuthController;
