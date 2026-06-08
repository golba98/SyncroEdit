const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * Filter request headers to exclude hop-by-hop and other connection-specific headers.
 * @param {Headers} headers
 * @returns {Headers}
 */
export function filterRequestHeaders(headers) {
  const filtered = new Headers();
  for (const [key, value] of headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      filtered.set(key, value);
    }
  }
  return filtered;
}

/**
 * Filter response headers, preserving multiple Set-Cookie headers using getSetCookie.
 * @param {Headers} headers
 * @returns {Headers}
 */
export function filterResponseHeaders(headers) {
  const filtered = new Headers();
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      continue;
    }
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      filtered.set(key, value);
    }
  }

  // Handle Set-Cookie specifically to ensure they are not combined
  if (typeof headers.getSetCookie === 'function') {
    const setCookies = headers.getSetCookie();
    for (const cookie of setCookies) {
      filtered.append('Set-Cookie', cookie);
    }
  } else {
    // Fallback if getSetCookie is not available in the testing environment
    const setCookie = headers.get('set-cookie');
    if (setCookie) {
      filtered.set('Set-Cookie', setCookie);
    }
  }

  return filtered;
}
