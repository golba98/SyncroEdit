import { getBackendOrigin } from '../config/env.js';
import { filterRequestHeaders, filterResponseHeaders } from '../utils/proxy.js';
import { errorResponse } from '../utils/responses.js';

export async function handleProxy(c) {
  const backendOrigin = getBackendOrigin(c);
  if (!backendOrigin) {
    return errorResponse(c, 'Backend origin configuration missing', 500);
  }

  const path = c.req.path;
  const subpath = path.replace(/^\/api\/node/, '');
  const targetPath = `/api${subpath}`;

  const targetUrl = new URL(targetPath, backendOrigin);
  const urlObj = new URL(c.req.url);
  targetUrl.search = urlObj.search;

  console.log(`[Proxy] Forwarding ${c.req.method} ${c.req.path} -> ${targetUrl.toString()}`);

  const filteredHeaders = filterRequestHeaders(c.req.raw.headers);

  const requestInit = {
    method: c.req.method,
    headers: filteredHeaders,
    redirect: 'manual',
  };

  // Only pass body stream for non-GET/HEAD methods that typically contain bodies
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
    requestInit.body = c.req.raw.body;
    requestInit.duplex = 'half';
  }

  try {
    const nodeResponse = await fetch(targetUrl.toString(), requestInit);

    const filteredResHeaders = filterResponseHeaders(nodeResponse.headers);

    return new Response(nodeResponse.body, {
      status: nodeResponse.status,
      headers: filteredResHeaders,
    });
  } catch (err) {
    console.error(`[Proxy Error] Failed to proxy request to ${targetUrl.toString()}:`, err);
    return errorResponse(c, 'Bad Gateway', 502);
  }
}
