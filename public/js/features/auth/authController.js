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
    this.usernameDebounceTimeout = null;
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

      if (input.id === 'signupUsername') {
        input.addEventListener('input', (e) => {
          this._handleUsernameAvailability(e.target.value);
        });
      }

      if (input.id === 'signupEmail') {
        input.addEventListener('blur', (e) => {
          this._checkEmailTypo(e.target.value);
        });
      }

      if (input.id === 'signupPassword' || input.id === 'signupPasswordConfirm') {
        input.addEventListener('input', () => {
          this._checkPasswordMatch();
        });
      }
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

    // Hide username status/suggestions and email suggestions
    const usernameStatusIcon = document.getElementById('usernameStatusIcon');
    if (usernameStatusIcon) usernameStatusIcon.style.display = 'none';
    const usernameSuggestions = document.getElementById('usernameSuggestions');
    if (usernameSuggestions) usernameSuggestions.style.display = 'none';
    const emailSuggestion = document.getElementById('emailSuggestion');
    if (emailSuggestion) emailSuggestion.style.display = 'none';
    const confirmInput = document.getElementById('signupPasswordConfirm');
    if (confirmInput) {
      confirmInput.style.borderColor = '';
      confirmInput.style.boxShadow = '';
    }

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
      if (e.message === 'Email verification required') {
        const email = e.data?.email || form.querySelector('#loginUsername')?.value?.trim();
        this._goToVerification(email, 'Verify your email before signing in.');
        return;
      }
      const msg = this._getAuthErrorMessage(e, 'Invalid username or password', 'Login failed');
      if (statusEl) statusEl.textContent = msg;
      this.synchro.onError();
      form.classList.add('shake-animation');
      setTimeout(() => form.classList.remove('shake-animation'), 1000);
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
      form.classList.add('shake-animation');
      setTimeout(() => form.classList.remove('shake-animation'), 1000);
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

      this.synchro.onSuccess();
      if (statusEl) {
        statusEl.textContent = '✓ ' + (data.message || 'Check your email for a verification code.');
        statusEl.className = 'status-message success';
      }
      this._goToVerification(
        email,
        data.message || 'Check your email for a verification code.',
        data.codeSent !== false,
        data.code
      );
    } catch (e) {
      showError(this._getAuthErrorMessage(e, '', 'Signup failed. Please try again.'));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    }
  }

  _goToVerification(email, message, codeSent = true, code = null) {
    if (!email) return;
    const docId = new URLSearchParams(window.location.search).get('doc');
    sessionStorage.setItem('verificationEmail', email);
    sessionStorage.setItem('verificationMessage', message || 'Use the code we just sent.');
    sessionStorage.setItem('codeSent', codeSent ? 'true' : 'false');
    sessionStorage.setItem('signupSuccess', 'true');
    if (code) {
      sessionStorage.setItem('verificationErrorCode', code);
    } else {
      sessionStorage.removeItem('verificationErrorCode');
    }
    if (docId) {
      sessionStorage.setItem('postLoginDocId', docId);
    }
    window.location.href = `/pages/verify.html?email=${encodeURIComponent(email)}`;
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
          await Network.fetchAPI('/api/auth/verify-email', {
            method: 'POST',
            body: JSON.stringify({ email, code, purpose: 'signup' }),
          });
          if (verificationMsg) {
            verificationMsg.textContent = '✓ Email verified! Please sign in.';
            verificationMsg.style.color = '#4caf50';
          }
          this.synchro.onSuccess();
          setTimeout(() => (window.location.href = '/pages/login.html?verified=1'), 1200);
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
          await Network.fetchAPI('/api/auth/send-verification', {
            method: 'POST',
            body: JSON.stringify({ email, purpose: 'signup' }),
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

  _getAuthErrorMessage(error, unauthorizedMessage, fallbackMessage) {
    if (error?.status === 401) {
      return unauthorizedMessage;
    }

    const code = error?.data?.code;
    if (code === 'EMAIL_NOT_CONFIGURED') {
      const isProduction =
        window.location.hostname === 'syncroedit.online' ||
        window.location.hostname === 'www.syncroedit.online';
      if (isProduction) {
        return 'Email verification is temporarily unavailable. Please contact support.';
      } else {
        return 'Email verification is not configured for this environment.\nSet RESEND_API_KEY, EMAIL_CODE_PEPPER, EMAIL_FROM, and APP_NAME for staging.';
      }
    }
    if (code === 'missing_email_code_pepper' || code === 'missing_email_delivery_config') {
      return 'Email verification is temporarily unavailable. Please contact support.';
    }

    return error?.message?.replace('API error: ', '') || fallbackMessage;
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

  _handleUsernameAvailability(username) {
    if (this.usernameDebounceTimeout) {
      clearTimeout(this.usernameDebounceTimeout);
    }

    const icon = document.getElementById('usernameStatusIcon');
    const suggestions = document.getElementById('usernameSuggestions');
    if (!icon) return;

    if (username.length < 3) {
      icon.style.display = 'none';
      if (suggestions) suggestions.style.display = 'none';
      return;
    }

    icon.style.display = 'block';
    this._setStatusIcon(icon, 'fas fa-spinner fa-spin', '#666');

    this.usernameDebounceTimeout = setTimeout(async () => {
      try {
        const data = await Network.fetchAPI('/api/auth/check-username', {
          method: 'POST',
          body: JSON.stringify({ username }),
        });
        if (data.available) {
          this._setStatusIcon(icon, 'fas fa-check-circle', 'var(--success-color, #10b981)');
          if (suggestions) suggestions.style.display = 'none';
        } else {
          this._setStatusIcon(icon, 'fas fa-times-circle', 'var(--error-color, #ef4444)');
          if (suggestions) {
            suggestions.style.display = 'block';
            suggestions.replaceChildren(document.createTextNode('Taken! Try: '));
            const links = (Array.isArray(data.suggestions) ? data.suggestions : []).map((s) => {
              const link = document.createElement('span');
              link.className = 'suggest-link';
              link.style.textDecoration = 'underline';
              link.style.cursor = 'pointer';
              link.style.marginRight = '8px';
              link.textContent = s;
              suggestions.append(link);
              return link;
            });
            links.forEach((link) => {
              link.onclick = () => {
                const usernameInput = document.getElementById('signupUsername');
                if (usernameInput) {
                  usernameInput.value = link.textContent;
                  this._handleUsernameAvailability(link.textContent);
                }
              };
            });
          }
        }
      } catch {
        icon.style.display = 'none';
      }
    }, 500);
  }

  _checkEmailTypo(email) {
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
    const parts = email.split('@');
    if (parts.length !== 2) return;
    const [user, domain] = parts;
    if (!domain) return;

    const suggestion = document.getElementById('emailSuggestion');
    if (!suggestion) return;

    const match = domains.find((d) => this._isSimilar(domain, d) && domain !== d);

    if (match) {
      suggestion.style.display = 'block';
      const suggestedEmail = `${user}@${match}`;
      const suggestionLink = document.createElement('span');
      suggestionLink.style.fontWeight = 'bold';
      suggestionLink.style.textDecoration = 'underline';
      suggestionLink.style.cursor = 'pointer';
      suggestionLink.textContent = suggestedEmail;
      suggestion.replaceChildren(
        document.createTextNode('Did you mean '),
        suggestionLink,
        document.createTextNode('?')
      );
      suggestionLink.onclick = () => {
        const emailInput = document.getElementById('signupEmail');
        if (emailInput) {
          emailInput.value = suggestedEmail;
          suggestion.style.display = 'none';
        }
      };
    } else {
      suggestion.style.display = 'none';
    }
  }

  _setStatusIcon(container, className, color) {
    const statusIcon = document.createElement('i');
    statusIcon.className = className;
    statusIcon.style.color = color;
    container.replaceChildren(statusIcon);
  }

  _isSimilar(s1, s2) {
    let diff = 0;
    for (let i = 0; i < Math.min(s1.length, s2.length); i++) {
      if (s1[i] !== s2[i]) diff++;
    }
    return diff === 1 && Math.abs(s1.length - s2.length) <= 1;
  }

  _checkPasswordMatch() {
    const p1 = document.getElementById('signupPassword')?.value || '';
    const p2 = document.getElementById('signupPasswordConfirm')?.value || '';
    const el = document.getElementById('signupPasswordConfirm');
    if (!el) return;

    if (p1 === p2 && p1 !== '') {
      el.style.borderColor = 'rgb(16, 185, 129)';
      el.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.4)';
    } else {
      el.style.borderColor = '';
      el.style.boxShadow = '';
    }
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
