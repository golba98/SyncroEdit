import { errorResponse } from '../utils/responses.js';

const buckets = new Map();

const RATE_LIMITS = {
  strict: { windowMs: 15 * 60 * 1000, max: 20 },
  authSensitive: { windowMs: 15 * 60 * 1000, max: 80 },
  default: { windowMs: 15 * 60 * 1000, max: 200 },
};

const STRICT_PATTERNS = [
  /^\/api\/node\/auth\/login$/i,
  /^\/api\/node\/auth\/signup$/i,
  /^\/api\/node\/auth\/register$/i,
  /^\/api\/node\/auth\/refresh-token$/i,
  /^\/api\/node\/auth\/ws-ticket$/i,
];

const AUTH_SENSITIVE_PATTERNS = [/^\/api\/node\/user(?:\/|$)/i, /^\/api\/node\/documents(?:\/|$)/i];

export function isEdgeRateLimitingEnabled(env = {}) {
  return String(env.EDGE_RATE_LIMITING_ENABLED || 'false').toLowerCase() === 'true';
}

export function getRateLimitCategory(path) {
  if (STRICT_PATTERNS.some((pattern) => pattern.test(path))) return 'strict';
  if (AUTH_SENSITIVE_PATTERNS.some((pattern) => pattern.test(path))) return 'authSensitive';
  return 'default';
}

function getClientKey(c) {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function pruneExpired(now) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export async function edgeRateLimit(c, next) {
  if (!isEdgeRateLimitingEnabled(c.env)) {
    return next();
  }

  const category = getRateLimitCategory(c.req.path);
  const limit = RATE_LIMITS[category] || RATE_LIMITS.default;
  const now = Date.now();
  pruneExpired(now);

  const bucketKey = `${category}:${getClientKey(c)}`;
  const current = buckets.get(bucketKey);
  const bucket =
    current && current.resetAt > now ? current : { count: 0, resetAt: now + limit.windowMs };

  bucket.count += 1;
  buckets.set(bucketKey, bucket);

  const remaining = Math.max(limit.max - bucket.count, 0);
  c.header('RateLimit-Limit', String(limit.max));
  c.header('RateLimit-Remaining', String(remaining));
  c.header('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > limit.max) {
    const retryAfter = Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1);
    c.header('Retry-After', String(retryAfter));
    return errorResponse(c, 'Too many requests', 429);
  }

  return next();
}

export function __clearRateLimitBucketsForTests() {
  buckets.clear();
}
