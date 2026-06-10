/**
 * @jest-environment jsdom
 */

import { Network } from '/js/app/network.js';
import { Auth } from '/js/features/auth/auth.js';

// Mock Auth
jest.mock('/js/features/auth/auth.js', () => ({
  Auth: {
    getToken: jest.fn(),
  },
}));

describe('Network Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.SYNCROEDIT_CONFIG = {
      API_BASE_URL: '',
      WS_BASE_URL: '',
    };
    global.fetch = jest.fn();
    Auth.getToken.mockReturnValue('mock-token');
  });

  describe('fetchAPI', () => {
    it('should add authorization header and content type', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      await Network.fetchAPI('/api/test', { method: 'POST', body: '{}' });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should throw error on non-ok response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(Network.fetchAPI('/api/test')).rejects.toThrow('API error: 500');
    });
  });

  describe('runtime URL config', () => {
    it('keeps same-origin API URLs by default', () => {
      expect(Network.getApiUrl('/api/auth/login')).toBe('/api/auth/login');
    });

    it('supports origin-only API base URLs', () => {
      window.SYNCROEDIT_CONFIG.API_BASE_URL = 'https://api.example.com';

      expect(Network.getApiUrl('/api/auth/login')).toBe('https://api.example.com/api/auth/login');
    });

    it('supports Worker API base URLs with a path', () => {
      window.SYNCROEDIT_CONFIG.API_BASE_URL = 'https://syncroedit.example.com/app';

      expect(Network.getApiUrl('/api/auth/login')).toBe(
        'https://syncroedit.example.com/app/api/auth/login'
      );
    });

    it('uses explicit WebSocket base URL when configured', () => {
      window.SYNCROEDIT_CONFIG.WS_BASE_URL = 'wss://syncroedit.example.com/ws';

      expect(Network.getWebSocketBaseUrl()).toBe('wss://syncroedit.example.com/ws');
    });

    it('derives WebSocket origin from API base URL when no explicit URL is configured', () => {
      window.SYNCROEDIT_CONFIG.API_BASE_URL = 'https://syncroedit.example.com';
      window.SYNCROEDIT_CONFIG.REALTIME_BACKEND = 'durable-object';

      expect(Network.getWebSocketBaseUrl()).toBe('wss://syncroedit.example.com');
    });
  });

  describe('initWebSocket', () => {
    let mockWebSocket;

    beforeEach(() => {
      mockWebSocket = {
        send: jest.fn(),
        close: jest.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      global.WebSocket = jest.fn(() => mockWebSocket);
    });

    it('should initialize WebSocket connection', async () => {
      const onMessage = jest.fn();
      const onStatusChange = jest.fn();

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ticket: 'mock-ticket' }),
      });

      Network.initWebSocket('doc1', onMessage, onStatusChange);

      // Wait for async connect()
      await new Promise(process.nextTick);

      expect(global.WebSocket).toHaveBeenCalled();

      // Simulate Open
      mockWebSocket.onopen();
      expect(onStatusChange).toHaveBeenCalledWith('connected');
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('/ws/doc1?ticket=mock-ticket')
      );
      expect(mockWebSocket.send).not.toHaveBeenCalled();
    });

    it('should handle incoming messages', async () => {
      const onMessage = jest.fn();

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ticket: 'mock-ticket' }),
      });

      Network.initWebSocket('doc1', onMessage);

      // Wait for async connect()
      await new Promise(process.nextTick);

      const message = { type: 'test', data: 'hello' };
      mockWebSocket.onmessage({ data: JSON.stringify(message) });

      expect(onMessage).toHaveBeenCalledWith(message);
    });

    it('should initialize WebSocket connection for durable-object backend', async () => {
      const onMessage = jest.fn();
      window.SYNCROEDIT_CONFIG.REALTIME_BACKEND = 'durable-object';
      window.SYNCROEDIT_CONFIG.API_BASE_URL = 'https://syncroedit.example.com';

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ ticket: 'mock-ticket' }),
      });

      Network.initWebSocket('doc1', onMessage);

      // Wait for async connect()
      await new Promise(process.nextTick);

      expect(global.WebSocket).toHaveBeenCalledWith(
        'wss://syncroedit.example.com/ws/doc1?ticket=mock-ticket'
      );
    });
  });
});
