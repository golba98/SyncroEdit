// Production configuration example for SyncroEdit
// Copy this file to 'config.production.js' or adapt it when building the deployment.
window.SYNCROEDIT_CONFIG = {
  // API_BASE_URL: Points to your production backend API.
  API_BASE_URL: 'https://synchroedit.pages.dev',

  // WS_BASE_URL: Points to your production WebSocket server.
  WS_BASE_URL: 'wss://synchroedit.pages.dev/ws',

  // REALTIME_BACKEND: Choose your realtime provider.
  // Options: 'durable-object' (Cloudflare Durable Objects realtime)
  REALTIME_BACKEND: 'durable-object',
};
