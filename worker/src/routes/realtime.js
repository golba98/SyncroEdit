import {
  getDocumentIdFromRequest,
  isRealtimeDurableObjectsEnabled,
  isValidDocumentId,
} from '../config/realtime.js';
import { errorResponse } from '../utils/responses.js';

export async function handleRealtime(c) {
  if (!isRealtimeDurableObjectsEnabled(c.env)) {
    return errorResponse(c, 'Durable Object realtime route disabled', 404);
  }

  if (!c.env?.DOCUMENT_SYNC_OBJECT) {
    return errorResponse(c, 'Realtime binding unavailable', 500);
  }

  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return errorResponse(c, 'Expected WebSocket upgrade', 426);
  }

  const documentId = getDocumentIdFromRequest(c);
  if (!isValidDocumentId(documentId)) {
    return errorResponse(c, 'Invalid document id', 400);
  }

  const durableObjectId = c.env.DOCUMENT_SYNC_OBJECT.idFromName(documentId);
  const stub = c.env.DOCUMENT_SYNC_OBJECT.get(durableObjectId);

  const targetUrl = new URL(c.req.url);
  targetUrl.searchParams.set('documentId', documentId);

  return stub.fetch(new Request(targetUrl.toString(), c.req.raw));
}
