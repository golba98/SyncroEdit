const request = require('supertest');
const { app } = require('../../src/server');

describe('Security Integration Tests', () => {
  describe('DoS Protection (Payload Size)', () => {
    it('should reject requests with payload > 10mb', async () => {
      // Create a large payload string (~11MB)
      const largePayload = 'a'.repeat(11 * 1024 * 1024);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', data: largePayload });

      expect(res.status).toBe(413); // Payload Too Large
    });

    it('should accept requests with payload < 10mb', async () => {
      // 1MB payload
      const payload = 'a'.repeat(1 * 1024 * 1024);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', password: 'password', data: payload });

      // Should not be 413. It will likely be 401 because creds are wrong, but that's fine.
      expect(res.status).not.toBe(413);
    });
  });

  describe('User Enumeration Protection', () => {
    it('should return generic error for verifyEmail when user does not exist', async () => {
      const res = await request(app).post('/api/auth/verify-email').send({
        email: 'nonexistent@example.com',
        verificationCode: '123456',
      });

      // It should NOT return "User not found"
      // It should return "Invalid verification code" (400)
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid verification code');
    });
  });

  describe('Session Revocation Enforcement', () => {
    it('should reject a valid JWT if its sessionId is removed from the database', async () => {
      const testUser = {
        username: 'sessiontest',
        email: 'session@test.com',
        password: 'TestPassword123!',
        isEmailVerified: true,
      };

      // 1. Setup user and login
      await require('../../src/users/User').create(testUser);
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: testUser.username, password: testUser.password });

      const token = loginRes.body.token;

      // 2. Verify it works initially
      const profileRes = await request(app)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${token}`);
      expect(profileRes.status).toBe(200);

      // 3. Revoke the session manually in DB
      const User = require('../../src/users/User');
      const user = await User.findOne({ username: testUser.username });
      user.sessions = [];
      await user.save();

      // 4. Verify it's now rejected
      const rejectedRes = await request(app)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(rejectedRes.status).toBe(401);
      expect(rejectedRes.body.message).toMatch(/session expired or revoked/i);
    });
  });
});
