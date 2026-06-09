const LOCAL_BACKEND_ORIGIN = 'http://localhost:3000';
const LOCAL_ENVIRONMENTS = new Set(['', 'development', 'dev', 'local', 'test']);

export function getEnvironment(env = {}) {
  return String(env.ENVIRONMENT || 'development').toLowerCase();
}

export function isProductionLikeEnvironment(env = {}) {
  return !LOCAL_ENVIRONMENTS.has(getEnvironment(env));
}

export function getBackendOrigin(c) {
  const origin = c.env?.BACKEND_ORIGIN;

  if (!origin && !isProductionLikeEnvironment(c.env)) {
    return LOCAL_BACKEND_ORIGIN;
  }

  if (!origin) return null;

  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}
