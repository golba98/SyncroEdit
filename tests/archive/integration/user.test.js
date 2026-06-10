const request = require('supertest');
const { app } = require('../../src/server');
const User = require('../../src/users/User');

describe('User Integration Tests', () => {
  let token;
  const testUser = {
    username: 'testuser_user',
    email: 'test_user@example.com',
    password: 'TestPassword123!',
  };

  beforeEach(async () => {
    await request(app).post('/api/auth/signup').send(testUser);
    const user = await User.findOne({ email: testUser.email });

    const verifyRes = await request(app).post('/api/auth/verify-email').send({
      email: testUser.email,
      verificationCode: user.verificationCode,
    });
    token = verifyRes.body.token;
  });

  describe('GET /api/user/profile', () => {
    it('should get user profile when authenticated', async () => {
      const res = await request(app)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testUser.email);
    });

    it('should return 401 if unauthenticated', async () => {
      const res = await request(app).get('/api/user/profile');
      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/user/profile', () => {
    it('should update user profile successfully', async () => {
      const updatedData = {
        accentColor: '#ff0000',
      };

      const res = await request(app)
        .put('/api/user/profile')
        .set('Authorization', `Bearer ${token}`)
        .send(updatedData);

      expect(res.status).toBe(200);
      expect(res.body.accentColor).toBe(updatedData.accentColor);
    });

    it('should persist showOnlineStatus toggle', async () => {
      const res = await request(app)
        .put('/api/user/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ showOnlineStatus: false });

      expect(res.status).toBe(200);
      expect(res.body.showOnlineStatus).toBe(false);

      const user = await User.findOne({ email: testUser.email });
      expect(user.showOnlineStatus).toBe(false);
    });
  });

  describe('PUT /api/user/password', () => {
    it('should update password successfully', async () => {
      const passwordData = {
        currentPassword: testUser.password,
        newPassword: 'NewTestPassword123!',
      };

      const res = await request(app)
        .put('/api/user/password')
        .set('Authorization', `Bearer ${token}`)
        .send(passwordData);

      expect(res.status).toBe(200);

      const loginRes = await request(app).post('/api/auth/login').send({
        username: testUser.username,
        password: 'NewTestPassword123!',
      });
      expect(loginRes.status).toBe(200);
    });

    it('should fail if current password is wrong', async () => {
      const passwordData = {
        currentPassword: 'wrong',
        newPassword: 'new',
      };
      const res = await request(app)
        .put('/api/user/password')
        .set('Authorization', `Bearer ${token}`)
        .send(passwordData);
      expect(res.status).toBe(400); // Or 401 depending on implementation
    });
  });

  describe('Session Management', () => {
    it('should get all active sessions', async () => {
      const res = await request(app)
        .get('/api/user/sessions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('sessionId');
      expect(res.body[0]).toHaveProperty('isCurrent');
    });

    it('should revoke a session', async () => {
      // Create a dummy session for the user
      const user = await User.findOne({ email: testUser.email });
      user.sessions.push({
        sessionId: 'dummy-session-id',
        refreshToken: 'dummy-hash',
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      });
      await user.save();

      const res = await request(app)
        .delete('/api/user/sessions/dummy-session-id')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      const updatedUser = await User.findOne({ email: testUser.email });
      const revokedSession = updatedUser.sessions.find((s) => s.sessionId === 'dummy-session-id');
      expect(revokedSession).toBeUndefined();
    });

    it('should revoke all other sessions', async () => {
      const user = await User.findOne({ email: testUser.email });
      user.sessions.push({
        sessionId: 'other-session-1',
        refreshToken: 'hash1',
        userAgent: 'agent1',
        ipAddress: '127.0.0.1',
      });
      user.sessions.push({
        sessionId: 'other-session-2',
        refreshToken: 'hash2',
        userAgent: 'agent2',
        ipAddress: '127.0.0.1',
      });
      await user.save();

      const res = await request(app)
        .delete('/api/user/sessions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      const updatedUser = await User.findOne({ email: testUser.email });
      // Should only have the current session left
      expect(updatedUser.sessions.length).toBe(1);
    });
  });
});
