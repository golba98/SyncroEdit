export function isRealtimeDurableObjectsEnabled(env = {}) {
  return String(env.REALTIME_DURABLE_OBJECTS_ENABLED || 'false').toLowerCase() === 'true';
}

export function getDocumentIdFromRequest(c) {
  return c.req.param('documentId') || new URL(c.req.url).searchParams.get('documentId');
}

export function isValidDocumentId(documentId) {
  return typeof documentId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(documentId);
}
