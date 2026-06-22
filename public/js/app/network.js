import { Auth } from '/js/features/auth/auth.js';

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
  async fetchAPI(url, options = {}) {
    let token = Auth.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const requestUrl = buildApiUrl(url);

    let response = await fetch(requestUrl, {
      ...options,
      headers,
      credentials: 'include',
    });

    // Interceptor: Check for 401 (Unauthorized)
    // Don't try to refresh if we are explicitly trying to login/signup/verify/logout or if we are already refreshing
    const isAuthRequest =
      url.includes('/login') ||
      url.includes('/signup') ||
      url.includes('/send-verification') ||
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
            } catch {
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
          response = await fetch(requestUrl, {
            ...options,
            headers,
            credentials: 'include',
          });
        } else {
          return;
        }
      } catch {
        return;
      }
    }

    if (!response.ok) {
      let message = `API error: ${response.status}`;
      let errData = null;
      try {
        errData = await response.json();
        if (errData && errData.message) message = errData.message;
      } catch {}
      const error = new Error(message);
      error.status = response.status;
      error.data = errData;
      throw error;
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
    let reconnectTimer = null;
    let connectionGeneration = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const describeSocketEvent = (event, socket) => ({
      type: event?.type || 'unknown',
      code: typeof event?.code === 'number' ? event.code : null,
      reason: event?.reason || '',
      wasClean: typeof event?.wasClean === 'boolean' ? event.wasClean : null,
      readyState: socket?.readyState ?? null,
      documentId,
    });

    const scheduleReconnect = (reason) => {
      if (isIntentionallyClosed || reconnectTimer) return;

      const delay = Math.min(Math.pow(2, reconnectAttempts) * 1000, maxReconnectDelay);
      reconnectAttempts++;
      if (onStatusChange) onStatusChange('reconnecting');

      console.warn('Scheduling WebSocket reconnect', {
        documentId,
        reason,
        delay,
      });
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = async () => {
      if (isIntentionallyClosed) return;

      const generation = ++connectionGeneration;
      if (onStatusChange) onStatusChange('connecting');

      try {
        // 1. Get a fresh ticket before every connection attempt
        // This also verifies the session is still active
        const { ticket } = await this.fetchAPI('/api/auth/ws-ticket');
        if (isIntentionallyClosed || generation !== connectionGeneration) return;

        const config = getRuntimeConfig();
        const realtimeBackend = config.REALTIME_BACKEND || 'durable-object';
        let wsFullUrl;
        if (realtimeBackend === 'durable-object') {
          let base = wsUrl;
          if (!base.endsWith('/ws')) {
            base = `${base.replace(/\/+$/, '')}/ws`;
          }
          wsFullUrl = `${base}/${documentId}?ticket=${ticket}`;
        } else {
          wsFullUrl = `${wsUrl}/?documentId=${documentId}&ticket=${ticket}`;
        }
        const socket = new WebSocket(wsFullUrl);
        ws = socket;

        socket.onopen = () => {
          if (isIntentionallyClosed || generation !== connectionGeneration || socket !== ws) return;
          console.log('Connected to server');
          reconnectAttempts = 0;
          if (onStatusChange) onStatusChange('connected');
          // No need to send join-document message as it is handled by URL params in upgrade
        };

        socket.onmessage = (event) => {
          if (isIntentionallyClosed || generation !== connectionGeneration || socket !== ws) return;
          try {
            const data = JSON.parse(event.data);
            onMessage(data);
          } catch (error) {
            console.error('WebSocket message error:', error);
          }
        };

        socket.onclose = (event) => {
          if (generation !== connectionGeneration || socket !== ws) return;
          ws = null;
          if (isIntentionallyClosed) return;

          console.warn('WebSocket closed', describeSocketEvent(event, socket));
          scheduleReconnect('unexpected-close');
        };

        socket.onerror = (error) => {
          if (generation !== connectionGeneration || socket !== ws) return;
          console.error('WebSocket error:', describeSocketEvent(error, socket));
          // Don't call onStatusChange('offline') yet, let onclose handle reconnection
          socket.close();
        };
      } catch (err) {
        if (isIntentionallyClosed || generation !== connectionGeneration) return;
        console.error('Failed to acquire WS ticket or connect:', err);
        scheduleReconnect('connect-failed');
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
        connectionGeneration++;
        clearReconnectTimer();
        if (ws) {
          const socket = ws;
          ws = null;
          socket.close();
        }
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
