import { successResponse } from '../utils/responses.js';

export function handleHealth(c) {
  return successResponse(c, {
    service: 'syncroedit-worker',
    runtime: 'cloudflare-workers',
  });
}
