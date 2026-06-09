export class DocumentSyncObject {
  constructor(state, env) {
    this.ctx = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const url = new URL(request.url);
    const documentId = url.searchParams.get('documentId') || 'unknown';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      documentId,
      connectedAt: Date.now(),
    });

    await this.ctx.storage.put('lastConnectedAt', Date.now());
    await this.ctx.storage.put('documentId', documentId);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws, message) {
    await this.ctx.storage.put('lastMessageAt', Date.now());

    for (const client of this.ctx.getWebSockets()) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  async webSocketClose() {
    await this.ctx.storage.put('lastDisconnectedAt', Date.now());
  }

  async webSocketError(ws, error) {
    console.error('DocumentSyncObject WebSocket error:', error);
    ws.close(1011, 'WebSocket error');
  }
}
