// Production configuration example for SyncroEdit.
// Copy this file to 'config.production.js' or adapt it when building the deployment.
window.SYNCROEDIT_CONFIG = {
  // API_BASE_URL: Same-origin is recommended for the Cloudflare Worker.
  API_BASE_URL: 'https://synchroedit.pages.dev',

  // WS_BASE_URL: Same Worker origin; /ws routes are handled by Durable Objects.
  WS_BASE_URL: 'wss://synchroedit.pages.dev/ws',

  REALTIME_BACKEND: 'durable-object',
};
