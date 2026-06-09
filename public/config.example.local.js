// Local configuration example for SyncroEdit
// Copy this file to 'config.local.js' to override defaults during local development.
window.SYNCROEDIT_CONFIG = {
  // API_BASE_URL: Points to your backend API.
  // - Default: '' (same-origin) or 'http://localhost:3000'
  API_BASE_URL: '',

  // WS_BASE_URL: Points to your WebSocket server.
  // - Default: '' (same-origin) or 'ws://localhost:3000'
  WS_BASE_URL: '',

  // REALTIME_BACKEND: Choose your realtime provider.
  // Options: 'node' (Node WebSocket backend)
  REALTIME_BACKEND: 'node',
};
