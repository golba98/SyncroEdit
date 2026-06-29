import { AppError } from './security.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CODE_TTL_SECONDS = 10 * 60;
export const SEND_WINDOW_SECONDS = 15 * 60;
export const MAX_ACTIVE_CODES_PER_EMAIL = 3;
const VERIFICATION_CODE_SPACE = 1000000;
const UINT32_RANGE = 0x100000000;
const VERIFICATION_CODE_RANDOM_LIMIT =
  Math.floor(UINT32_RANGE / VERIFICATION_CODE_SPACE) * VERIFICATION_CODE_SPACE;

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isValidEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && normalized.length <= 254 && EMAIL_REGEX.test(normalized);
}

export function generateCode() {
  const randomValue = new Uint32Array(1);
  let value;

  do {
    crypto.getRandomValues(randomValue);
    value = randomValue[0];
  } while (value >= VERIFICATION_CODE_RANDOM_LIMIT);

  return String(value % VERIFICATION_CODE_SPACE).padStart(6, '0');
}

export async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashCode({ email, code, pepper }) {
  return sha256Hex(`${normalizeEmail(email)}:${code}:${pepper}`);
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export function requireEmailCodePepper(env) {
  const pepper = env && typeof env.EMAIL_CODE_PEPPER === 'string' ? env.EMAIL_CODE_PEPPER : '';
  if (pepper.trim().length < 16) {
    throw new AppError(500, 'Email verification is not configured', 'missing_email_code_pepper');
  }
  return pepper;
}

function requireResendConfig(env) {
  const apiKey = env && typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  const from = env && typeof env.EMAIL_FROM === 'string' ? env.EMAIL_FROM.trim() : '';
  const appName = env && typeof env.APP_NAME === 'string' ? env.APP_NAME.trim() : 'SyncroEdit';

  if (!apiKey || !from) {
    throw new AppError(500, 'Email delivery is not configured', 'missing_email_delivery_config');
  }

  return { apiKey, from, appName };
}

export async function sendVerificationEmail(env, email, code) {
  if (env && env.NODE_ENV === 'test') {
    return;
  }

  const { apiKey, from, appName } = requireResendConfig(env);
  const safeAppName = escapeHtml(appName);
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
      <h1 style="font-size:20px;margin:0 0 12px">${safeAppName} verification code</h1>
      <p>Use this code to verify your email address:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0">${code}</p>
      <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email,
      subject: 'Your SyncroEdit verification code',
      html,
    }),
  });

  if (!response.ok) {
    const responseBody =
      typeof response.text === 'function' ? await response.text().catch(() => '') : '';
    const error = new AppError(502, 'Unable to send verification email', 'email_send_failed');
    error.provider = 'resend';
    error.providerStatus = response.status;
    error.providerResponse = responseBody;
    throw error;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}
