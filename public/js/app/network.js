import { Auth } from '/js/features/auth/auth.js';

let _csrfToken = null;
let _csrfPromise = null;
let _refreshPromise = null;

function getRuntimeConfig() {
  return window.SYNCROEDIT_CONFIG || {};
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function isAbsoluteUrl(url) {
  return /^https?:\/\//i.test(url);
}

function buildApiUrl(url) {
  if (isAbsoluteUrl(url)) return url;

  const apiBaseUrl = trimTrailingSlash(getRuntimeConfig().API_BASE_URL);
  if (!apiBaseUrl) return url;

  const normalizedUrl = String(url);
  const requestPath = normalizedUrl.replace(/^\/+/, '');
  const basePath = new URL(apiBaseUrl, window.location.origin).pathname.replace(/\/+$/, '');

  if (basePath && basePath !== '/' && requestPath.startsWith('api/')) {
    return `${apiBaseUrl}/${requestPath.replace(/^api\/?/, '')}`;
  }

  return `${apiBaseUrl}/${requestPath}`;
}

function getConfiguredWebSocketBaseUrl() {
  const config = getRuntimeConfig();
  const explicitWsBaseUrl = trimTrailingSlash(config.WS_BASE_URL);

  if (explicitWsBaseUrl) return explicitWsBaseUrl;

  const apiBaseUrl = trimTrailingSlash(config.API_BASE_URL);
  if (apiBaseUrl) {
    return apiBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export const Network = {
  async fetchCsrfToken() {
    if (_csrfPromise) return _csrfPromise;

    _csrfPromise = (async () => {
      try {
        const response = await fetch(buildApiUrl('/api/auth/csrf-token'), {
          credentials: 'include',
        });
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        _csrfToken = data.csrfToken;
        return _csrfToken;
      } catch (err) {
        console.error('Failed to fetch CSRF token:', err);
        _csrfToken = null;
        return null;
      } finally {
        _csrfPromise = null;
      }
    })();

    return _csrfPromise;
  },

  async fetchAPI(url, options = {}) {
    if (!_csrfToken && !url.includes('/csrf-token')) {
      await this.fetchCsrfToken();
    }

    let token = Auth.getToken();
    const headers = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': _csrfToken,
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Debug CSRF
    // console.log(`[Network] Fetching ${url} with CSRF: ${_csrfToken ? _csrfToken.substring(0,10)+'...' : 'null'}`);

    const requestUrl = buildApiUrl(url);

    let response = await fetch(requestUrl, { ...options, headers, credentials: 'include' });

    // Interceptor: Check for 403 (Forbidden) - could be CSRF failure
    if (response.status === 403 && !url.includes('/csrf-token')) {
      console.warn('Potential CSRF failure or access denied, retrying with fresh token...');
      await this.fetchCsrfToken();
      headers['X-CSRF-Token'] = _csrfToken;
      response = await fetch(requestUrl, { ...options, headers, credentials: 'include' });
    }

    // Interceptor: Check for 401 (Unauthorized)
    // Don't try to refresh if we are explicitly trying to login/signup/verify/logout or if we are already refreshing
    const isAuthRequest =
      url.includes('/login') ||
      url.includes('/signup') ||
      url.includes('/verify-email') ||
      url.includes('/logout') ||
      url.includes('/refresh-token');

    if (response.status === 401 && !isAuthRequest) {
      // console.log('Token expired, attempting refresh...'); // Reduced noise
      try {
        if (!_refreshPromise) {
          _refreshPromise = (async () => {
            try {
              const refreshResponse = await fetch(buildApiUrl('/api/auth/refresh-token'), {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': _csrfToken,
                },
                credentials: 'include',
              });

              if (refreshResponse.ok) {
                const data = await refreshResponse.json();
                Auth.setToken(data.token); // Update local token
                return data.token;
              } else {
                await Auth.logout();
                return null;
              }
            } catch (e) {
              await Auth.logout();
              return null;
            } finally {
              _refreshPromise = null;
            }
          })();
        }

        const newToken = await _refreshPromise;
        if (newToken) {
          // Retry original request with new token
          headers.Authorization = `Bearer ${newToken}`;
          response = await fetch(requestUrl, { ...options, headers, credentials: 'include' });
        } else {
          return;
        }
      } catch (e) {
        return;
      }
    }

    if (!response.ok) {
      let message = `API error: ${response.status}`;
      try {
        const errData = await response.json();
        if (errData && errData.message) message = errData.message;
      } catch (_) {}
      throw new Error(message);
    }
    return response.json();
  },

  async getDocuments() {
    return this.fetchAPI('/api/documents');
  },

  async createDocument(title = 'Untitled document', pages = [{ content: '' }]) {
    return this.fetchAPI('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ title, pages }),
    });
  },

  async deleteDocument(docId) {
    return this.fetchAPI(`/api/documents/${docId}`, {
      method: 'DELETE',
    });
  },

  async addToRecent(docId) {
    return this.fetchAPI(`/api/documents/${docId}/recent`, {
      method: 'POST',
    });
  },

  async getHistory(docId) {
    return this.fetchAPI(`/api/documents/${docId}/history`);
  },

  async getDocumentSettings(docId) {
    return this.fetchAPI(`/api/documents/${docId}/settings`);
  },

  async updateDocumentSettings(docId, settings) {
    return this.fetchAPI(`/api/documents/${docId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  },

  async transferOwnership(docId, newOwnerUsername) {
    return this.fetchAPI(`/api/documents/${docId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ newOwnerUsername }),
    });
  },

  getApiUrl(url) {
    return buildApiUrl(url);
  },

  getWebSocketBaseUrl() {
    return getConfiguredWebSocketBaseUrl();
  },

  initWebSocket(documentId, onMessage, onStatusChange) {
    const wsUrl = this.getWebSocketBaseUrl();
    let ws = null;
    let reconnectAttempts = 0;
    const maxReconnectDelay = 30000;
    let isIntentionallyClosed = false;

    const connect = async () => {
      if (isIntentionallyClosed) return;

      try {
        // 1. Get a fresh ticket before every connection attempt
        // This also verifies the session is still active
        const { ticket } = await this.fetchAPI('/api/auth/ws-ticket');

        const wsFullUrl = `${wsUrl}/?documentId=${documentId}&ticket=${ticket}`;
        ws = new WebSocket(wsFullUrl);

        ws.onopen = () => {
          console.log('Connected to server');
          reconnectAttempts = 0;
          if (onStatusChange) onStatusChange('connected');
          // No need to send join-document message as it is handled by URL params in upgrade
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onMessage(data);
          } catch (error) {
            console.error('WebSocket message error:', error);
          }
        };

        ws.onclose = () => {
          if (isIntentionallyClosed) return;

          console.log('Disconnected from server');
          if (onStatusChange) onStatusChange('reconnecting');

          const delay = Math.min(Math.pow(2, reconnectAttempts) * 1000, maxReconnectDelay);
          reconnectAttempts++;

          setTimeout(connect, delay);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          // Don't call onStatusChange('offline') yet, let onclose handle reconnection
          ws.close();
        };
      } catch (err) {
        console.error('Failed to acquire WS ticket or connect:', err);
        if (onStatusChange) onStatusChange('reconnecting');

        // If the ticket fetch failed (e.g. 401), fetchAPI already tried to refresh the token.
        // If it still fails, the user is likely logged out.
        const delay = Math.min(Math.pow(2, reconnectAttempts) * 1000, maxReconnectDelay);
        reconnectAttempts++;
        setTimeout(connect, delay);
      }
    };

    const socketProxy = {
      send: (message) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
          return true;
        }
        return false;
      },
      close: () => {
        isIntentionallyClosed = true;
        if (ws) ws.close();
      },
    };

    connect();
    return socketProxy;
  },

  sendWS(wsProxy, message) {
    if (wsProxy) {
      wsProxy.send(message);
    }
  },
};
