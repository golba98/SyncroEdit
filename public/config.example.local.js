// Local configuration example for SyncroEdit
// Copy this file to 'config.local.js' to override defaults during local development.
window.SYNCROEDIT_CONFIG = {
  // API_BASE_URL: Points to your backend API.
  // - Node fallback / default: '' (same-origin) or 'http://localhost:3000'
  // - Cloudflare Worker proxy local endpoint: 'http://localhost:8787/api/node'
  API_BASE_URL: '',

  // WS_BASE_URL: Points to your WebSocket server.
  // - Node fallback / default: '' (same-origin) or 'ws://localhost:3000'
  // - Cloudflare Worker proxy local endpoint: 'ws://localhost:8787'
  WS_BASE_URL: '',

  // REALTIME_BACKEND: Choose your realtime provider.
  // Options: 'node' (Node WebSocket fallback), 'durable-object' (Cloudflare Durable Objects)
  REALTIME_BACKEND: 'node',
};
