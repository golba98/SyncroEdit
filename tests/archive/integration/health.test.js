const request = require('supertest');
const { app } = require('../../src/server');

describe('Health and Config Integration Tests', () => {
  describe('GET /health', () => {
    it('should return 200 OK and health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.env).toBeDefined();
    });
  });

  describe('GET /api/config', () => {
    it('should return 200 OK and configuration object', async () => {
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body.emailVerificationEnabled).toBeDefined();
      expect(res.body.realtimeBackend).toBe('node');
    });
  });
});
