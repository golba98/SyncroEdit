export class AppError extends Error {
  constructor(status, message, code = 'request_failed') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])(?=.{8,})/;
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const LIMITS = {
  authBody: 4096,
  profileBody: 8192,
  documentBody: 65536,
  title: 160,
  pageContent: 50000,
  bio: 500,
  profilePicture: 2048,
  websocketMessage: 1024 * 1024,
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.quilljs.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
    "script-src 'self' 'unsafe-inline' https://cdn.quilljs.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://esm.sh",
    "connect-src 'self' https: wss:",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY',
};

export function applySecurityHeaders(headers) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
}

export async function securityHeaders(c, next) {
  await next();
  applySecurityHeaders(c.res.headers);
}

export function jsonError(c, status, message, code = 'request_failed') {
  return c.json({ message, code }, status);
}

export function requireDb(env) {
  if (!env || !env.DB || typeof env.DB.prepare !== 'function') {
    throw new AppError(500, 'Database binding is not configured', 'missing_db_binding');
  }
  return env.DB;
}

export function requireJwtSecret(env) {
  const secret = env && typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET.trim() : '';
  if (secret.length < 16) {
    throw new AppError(500, 'JWT secret is not configured', 'missing_jwt_secret');
  }
  return secret;
}

export function requireDurableObject(env, bindingName) {
  const binding = env && env[bindingName];
  if (!binding || typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') {
    throw new AppError(500, `${bindingName} binding is not configured`, 'missing_do_binding');
  }
  return binding;
}

export async function readJson(c, maxBytes = LIMITS.authBody) {
  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new AppError(413, 'Request body is too large', 'body_too_large');
  }

  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Invalid JSON object');
    }
    return body;
  } catch {
    throw new AppError(400, 'Invalid JSON request body', 'invalid_json');
  }
}

export function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateUsername(username) {
  const clean = cleanString(username);
  if (!USERNAME_REGEX.test(clean)) {
    throw new AppError(
      400,
      'Username must be 3-32 characters and use only letters, numbers, underscores, or hyphens',
      'invalid_username'
    );
  }
  return clean;
}

export function validateEmail(email) {
  const clean = cleanString(email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) {
    throw new AppError(400, 'Invalid email address', 'invalid_email');
  }
  return clean;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || !PASSWORD_REGEX.test(password)) {
    throw new AppError(
      400,
      'Password must be at least 8 characters long and include uppercase, lowercase, number, and symbol characters',
      'invalid_password'
    );
  }
  return password;
}

export function validateUuid(value, label = 'id') {
  const clean = cleanString(value);
  if (!UUID_REGEX.test(clean)) {
    throw new AppError(400, `Invalid ${label}`, 'invalid_id');
  }
  return clean;
}

export function validateBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new AppError(400, `${label} must be a boolean`, 'invalid_boolean');
  }
  return value;
}

export function validateTitle(value, fallback = 'Untitled document') {
  const title = cleanString(value || fallback);
  if (!title || title.length > LIMITS.title) {
    throw new AppError(400, `Title must be 1-${LIMITS.title} characters`, 'invalid_title');
  }
  return title;
}

export function validatePageContent(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > LIMITS.pageContent) {
    throw new AppError(400, 'Page content is invalid or too large', 'invalid_page_content');
  }
  return value;
}

export function validateRole(role) {
  if (role !== 'viewer' && role !== 'editor') {
    throw new AppError(400, 'Permission role must be viewer or editor', 'invalid_role');
  }
  return role;
}

export function getClientIp(c) {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function getAllowedCorsOrigin(c) {
  const origin = c.req.header('Origin');
  if (!origin) return null;

  const requestOrigin = new URL(c.req.url).origin;
  const allowed = new Set([
    requestOrigin,
    'http://localhost:8787',
    'http://127.0.0.1:8787',
    'https://syncroedit.online',
    'https://www.syncroedit.online',
    ...String(c.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ]);

  return allowed.has(origin) ? origin : null;
}

export async function tightCors(c, next) {
  const allowedOrigin = getAllowedCorsOrigin(c);

  if (c.req.method === 'OPTIONS') {
    const headers = new Headers();
    if (allowedOrigin) {
      headers.set('Access-Control-Allow-Origin', allowedOrigin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      headers.set('Access-Control-Max-Age', '600');
    }
    applySecurityHeaders(headers);
    return new Response(null, { status: 204, headers });
  }

  await next();

  if (allowedOrigin) {
    c.res.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    c.res.headers.set('Access-Control-Allow-Credentials', 'true');
    c.res.headers.append('Vary', 'Origin');
  }
}

export async function getDocumentAccess(db, docId, userId) {
  const doc = await db
    .prepare('SELECT owner, title, isPublic FROM documents WHERE id = ?')
    .bind(docId)
    .first();
  if (!doc) {
    throw new AppError(404, 'Document not found', 'document_not_found');
  }

  const permission = await db
    .prepare('SELECT role FROM document_permissions WHERE documentId = ? AND userId = ?')
    .bind(docId, userId)
    .first();

  const isOwner = doc.owner === userId;
  const role = isOwner ? 'owner' : permission ? validateRole(permission.role) : null;
  const canRead = isOwner || role === 'editor' || role === 'viewer' || doc.isPublic === 1;
  const canEdit = isOwner || role === 'editor';

  return {
    doc,
    permission,
    role,
    isOwner,
    canRead,
    canEdit,
    isPublic: doc.isPublic === 1,
  };
}

export function assertDocumentReadable(access) {
  if (!access.canRead) {
    throw new AppError(403, 'Access denied', 'access_denied');
  }
}

export function assertDocumentEditable(access) {
  if (!access.canEdit) {
    throw new AppError(403, 'Editor permission required', 'editor_required');
  }
}

export function assertDocumentOwner(access) {
  if (!access.isOwner) {
    throw new AppError(403, 'Only the document owner can perform this action', 'owner_required');
  }
}
