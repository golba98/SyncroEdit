// Production configuration example for SyncroEdit
// Copy this file to 'config.production.js' or adapt it when building the deployment.
window.SYNCROEDIT_CONFIG = {
  // API_BASE_URL: Points to your production backend API.
  API_BASE_URL: 'https://api.syncroedit.example.com',

  // WS_BASE_URL: Points to your production WebSocket server.
  WS_BASE_URL: 'wss://api.syncroedit.example.com/ws',

  // REALTIME_BACKEND: Choose your realtime provider.
  // Options: 'node' (Node WebSocket backend)
  REALTIME_BACKEND: 'node',
};
