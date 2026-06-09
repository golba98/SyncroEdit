// Production configuration example for SyncroEdit
// Copy this file to 'config.production.js' or adapt it when building the Pages deployment.
window.SYNCROEDIT_CONFIG = {
  // API_BASE_URL: Points to your backend API.
  // - For hybrid Cloudflare migration: Use the custom domain of your Worker (e.g., 'https://syncroedit.example.com/api/node')
  //   which proxies requests to the Node backend.
  API_BASE_URL: 'https://syncroedit.example.com/api/node',

  // WS_BASE_URL: Points to your WebSocket server.
  // - Node fallback / default: 'wss://syncroedit.example.com/ws'
  // - Cloudflare Durable Objects realtime: 'wss://syncroedit.example.com' (path /ws is appended automatically)
  WS_BASE_URL: 'wss://syncroedit.example.com/ws',

  // REALTIME_BACKEND: Choose your realtime provider.
  // Options: 'node' (Node WebSocket fallback), 'durable-object' (Cloudflare Durable Objects)
  REALTIME_BACKEND: 'node',
};
