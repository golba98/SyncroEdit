const request = require('supertest');
const { app } = require('../../src/server');

describe('Logout Integration Tests', () => {
  it('should clear refreshToken cookie on logout', async () => {
    const res = await request(app).post('/api/auth/logout').expect(200);

    expect(res.body.message).toBe('Logged out successfully');

    // Check Set-Cookie header
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies).toEqual(expect.arrayContaining([expect.stringMatching(/refreshToken=;/)]));
    expect(cookies).toEqual(
      expect.arrayContaining([expect.stringMatching(/Expires=Thu, 01 Jan 1970/)])
    );
  });
});
