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

  const ticket = c.req.query('ticket') || new URL(c.req.url).searchParams.get('ticket');
  let userId = 'unknown';
  let username = 'unknown';
  let readOnly = false;

  const backendOrigin = c.env?.BACKEND_ORIGIN;
  if (backendOrigin) {
    if (!ticket) {
      return errorResponse(c, 'Authentication ticket required', 401);
    }

    try {
      const consumeUrl = `${backendOrigin.replace(/\/+$/, '')}/api/auth/ws-ticket/consume`;
      const response = await fetch(consumeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticket, documentId }),
      });

      if (!response.ok) {
        return errorResponse(c, 'Ticket validation failed', response.status);
      }

      const data = await response.json();
      if (!data || !data.ok || !data.user) {
        return errorResponse(c, 'Invalid ticket response', 401);
      }

      userId = data.user.id;
      username = data.user.username;
      readOnly = !!data.readOnly;
    } catch (err) {
      console.error('Error contacting backend to consume ticket:', err);
      return errorResponse(c, 'Ticket validation service unavailable', 500);
    }
  }

  const durableObjectId = c.env.DOCUMENT_SYNC_OBJECT.idFromName(documentId);
  const stub = c.env.DOCUMENT_SYNC_OBJECT.get(durableObjectId);

  const targetUrl = new URL(c.req.url);
  targetUrl.searchParams.set('documentId', documentId);
  targetUrl.searchParams.set('userId', userId);
  targetUrl.searchParams.set('username', username);
  targetUrl.searchParams.set('readOnly', readOnly ? 'true' : 'false');

  return stub.fetch(new Request(targetUrl.toString(), c.req.raw));
}
