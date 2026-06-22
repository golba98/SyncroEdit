const { expect } = require('@playwright/test');

const PASSWORD = 'Password123!';
const TEST_CODE = '123456';

async function registerVerifyAndLogin(page, username) {
  await page.goto('/pages/login.html');
  await page.click('#showSignup');
  await page.fill('#signupUsername', username);
  await page.fill('#signupEmail', `${username}@example.com`);
  await page.fill('#signupPassword', PASSWORD);
  await page.fill('#signupPasswordConfirm', PASSWORD);
  await page.click('#signupBtn');

  await expect(page).toHaveURL(/\/pages\/verify(?:\.html)?/);
  await page.fill('#codeInput', TEST_CODE);
  await page.click('#verifyBtn');
  await expect(page).toHaveURL(/\/pages\/login(?:\.html)?/);

  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', PASSWORD);
  await page.click('#loginBtn');
  await expect(page).toHaveURL(/\/(?:index\.html)?$/);
}

async function createVerifiedSessionViaApi(page, username) {
  const email = `${username}@example.com`;
  const signupResponse = await page.request.post('/api/auth/signup', {
    data: {
      username,
      email,
      password: PASSWORD,
    },
  });
  expect(signupResponse.ok()).toBeTruthy();

  const verifyResponse = await page.request.post('/api/auth/verify-email', {
    data: {
      email,
      code: TEST_CODE,
      purpose: 'signup',
    },
  });
  expect(verifyResponse.ok()).toBeTruthy();

  const loginResponse = await page.request.post('/api/auth/login', {
    data: {
      username,
      password: PASSWORD,
    },
  });
  expect(loginResponse.ok()).toBeTruthy();
}

module.exports = {
  PASSWORD,
  TEST_CODE,
  createVerifiedSessionViaApi,
  registerVerifyAndLogin,
};
