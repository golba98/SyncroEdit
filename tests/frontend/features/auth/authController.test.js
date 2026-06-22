/**
 * @jest-environment jsdom
 */

const mockSynchroMethods = {
  init: jest.fn(),
  onFieldFocus: jest.fn(),
  onFieldBlur: jest.fn(),
  onFieldInput: jest.fn(),
  onPasswordToggle: jest.fn(),
  onButtonHover: jest.fn(),
  onButtonClick: jest.fn(),
  onFormSwitch: jest.fn(),
  onSuccess: jest.fn(),
  onError: jest.fn(),
};

jest.mock('/js/features/auth/synchro/SynchroBot.js', () => ({
  SynchroBot: jest.fn().mockImplementation(() => mockSynchroMethods),
}));

jest.mock('/js/app/network.js', () => ({
  Network: {
    fetchAPI: jest.fn(),
  },
}));

jest.mock('/js/features/auth/auth.js', () => ({
  Auth: {
    login: jest.fn(),
    signup: jest.fn(),
    setToken: jest.fn(),
  },
}));

describe('AuthController DOM rendering', () => {
  let AuthController;
  let Network;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    document.title = 'SynchroEdit - Login';
    document.body.innerHTML = `
      <div class="character-container"></div>
      <span id="usernameStatusIcon"></span>
      <div id="usernameSuggestions"></div>
      <div id="emailSuggestion"></div>
      <form id="loginForm">
        <input id="loginUsername" type="text" value="golba98" />
        <input id="loginPassword" type="password" value="TesterPassword123!" />
        <div id="loginStatusMessage"></div>
      </form>
      <form id="signupForm">
        <input id="signupUsername" type="text" />
        <input id="signupEmail" type="email" />
        <input id="signupPassword" type="password" value="Password123!" />
        <input id="signupPasswordConfirm" type="password" value="Password123!" />
        <div id="signupStatusMessage"></div>
        <button id="signupBtn" type="button">Create Account</button>
      </form>
    `;

    ({ Network } = require('/js/app/network.js'));
    AuthController = require('/js/features/auth/authController.js').default;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders email typo suggestions as text instead of parsing user input as HTML', () => {
    const controller = new AuthController();
    const suggestion = document.getElementById('emailSuggestion');

    controller._checkEmailTypo('<img src=x onerror=alert(1)>@gnail.com');

    expect(suggestion.style.display).toBe('block');
    expect(suggestion.textContent).toContain('<img src=x onerror=alert(1)>@gmail.com');
    expect(suggestion.querySelector('img')).toBeNull();
  });

  it('renders username suggestions from the API as text instead of parsing them as HTML', async () => {
    Network.fetchAPI.mockResolvedValue({
      available: false,
      suggestions: ['<img src=x onerror=alert(1)>', 'plain-user'],
    });
    const controller = new AuthController();
    const suggestions = document.getElementById('usernameSuggestions');

    controller._handleUsernameAvailability('takenuser');
    jest.advanceTimersByTime(500);
    await Promise.resolve();

    expect(suggestions.style.display).toBe('block');
    expect(suggestions.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(suggestions.querySelector('img')).toBeNull();
    expect(suggestions.querySelectorAll('.suggest-link')).toHaveLength(2);
  });

  it('shows a clear login message when email verification delivery is not configured', async () => {
    Network.fetchAPI.mockRejectedValue({
      message: 'Internal Server Error',
      status: 500,
      data: { code: 'missing_email_delivery_config' },
    });

    const controller = new AuthController();
    const form = document.getElementById('loginForm');
    const status = document.getElementById('loginStatusMessage');

    await controller._handleLogin(form);

    expect(status.textContent).toBe(
      'Email verification is temporarily unavailable. Please contact support.'
    );
  });

  it('shows a clear signup message when email verification hashing is not configured', async () => {
    Network.fetchAPI.mockRejectedValue({
      message: 'Internal Server Error',
      status: 500,
      data: { code: 'missing_email_code_pepper' },
    });

    const controller = new AuthController();
    const form = document.getElementById('signupForm');
    const status = document.getElementById('signupStatusMessage');

    document.getElementById('signupUsername').value = 'newuser';
    document.getElementById('signupEmail').value = 'newuser@example.com';

    await controller._handleSignup(form);

    expect(status.textContent).toBe(
      '✗ Email verification is temporarily unavailable. Please contact support.'
    );
  });
});
