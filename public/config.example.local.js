// Local configuration example for SyncroEdit
// Copy this file to 'config.local.js' to override defaults during local development.
window.SYNCROEDIT_CONFIG = {
  // API_BASE_URL: Points to your backend API.
  // - Default: '' (same-origin) or 'http://localhost:8787' for wrangler local dev
  API_BASE_URL: '',

  // WS_BASE_URL: Points to your WebSocket server.
  // - Default: '' (same-origin) or 'ws://localhost:8787' for wrangler local dev
  WS_BASE_URL: '',

  // REALTIME_BACKEND: Choose your realtime provider.
  // Options: 'durable-object' (Cloudflare Durable Objects realtime)
  REALTIME_BACKEND: 'durable-object',
};
