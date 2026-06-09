const request = require('supertest');
const { app } = require('../../src/server');
const User = require('../../src/users/User');

describe('Auth Integration Tests', () => {
  const testUser = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'TestPassword123!',
  };

  describe('POST /api/auth/signup', () => {
    it('should register a new user successfully (pending verification)', async () => {
      const res = await request(app).post('/api/auth/signup').send(testUser);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/receive a verification code/i);

      const user = await User.findOne({ email: testUser.email });
      expect(user).toBeTruthy();
      expect(user.isEmailVerified).toBe(false);
      expect(user.verificationCode).toBeTruthy();
    });

    it('should return 400 if password does not meet complexity requirements', async () => {
      const weakUser = {
        username: 'weakuser',
        email: 'weak@example.com',
        password: 'password123', // Missing uppercase and symbol
      };

      const res = await request(app).post('/api/auth/signup').send(weakUser);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/password/i);
    });

    it('should return 409 if email already exists', async () => {
      await User.create({ ...testUser, username: 'existinguser' });

      const res = await request(app).post('/api/auth/signup').send(testUser);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/email is already registered/i);
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('should verify email with correct code', async () => {
      await request(app).post('/api/auth/signup').send(testUser);
      const user = await User.findOne({ email: testUser.email });

      const res = await request(app).post('/api/auth/verify-email').send({
        email: testUser.email,
        verificationCode: user.verificationCode,
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/verified successfully/i);
      expect(res.body.token).toBeTruthy();

      // Check for Refresh Token Cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.includes('refreshToken'))).toBe(true);

      const updatedUser = await User.findOne({ email: testUser.email });
      expect(updatedUser.isEmailVerified).toBe(true);
    });
  });

  describe('POST /api/auth/resend-code', () => {
    it('should resend code if user exists and is not verified', async () => {
      await request(app).post('/api/auth/signup').send(testUser);

      const res = await request(app).post('/api/auth/resend-code').send({ email: testUser.email });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/code has been sent/i);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login successfully if verified', async () => {
      await request(app).post('/api/auth/signup').send(testUser);
      const user = await User.findOne({ email: testUser.email });
      await request(app).post('/api/auth/verify-email').send({
        email: testUser.email,
        verificationCode: user.verificationCode,
      });

      const res = await request(app).post('/api/auth/login').send({
        username: testUser.username,
        password: testUser.password,
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some((c) => c.includes('refreshToken'))).toBe(true);
    });

    it('should return 403 if email not verified', async () => {
      await request(app).post('/api/auth/signup').send(testUser);

      const res = await request(app).post('/api/auth/login').send({
        username: testUser.username,
        password: testUser.password,
      });

      expect(res.status).toBe(403);
      expect(res.body.requiresVerification).toBe(true);
    });

    it('should return 401 if password is incorrect', async () => {
      await request(app).post('/api/auth/signup').send(testUser);
      const user = await User.findOne({ email: testUser.email });
      // Verify manually to bypass check
      user.isEmailVerified = true;
      await user.save();

      const res = await request(app).post('/api/auth/login').send({
        username: testUser.username,
        password: 'wrongpassword',
      });

      expect(res.status).toBe(401);
    });

    it('should return 401 if user does not exist', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'nonexistent',
        password: 'password',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/refresh-token', () => {
    it('should rotate tokens if valid refresh token provided in cookie', async () => {
      // 1. Login to get cookie
      await User.create({ ...testUser, isEmailVerified: true });
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: testUser.username, password: testUser.password });

      const refreshTokenCookie = loginRes.headers['set-cookie'].find((c) =>
        c.startsWith('refreshToken=')
      );

      // 2. Use refresh token
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .set('Cookie', [refreshTokenCookie]);

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.headers['set-cookie']).toBeDefined();

      const newCookie = res.headers['set-cookie'].find((c) => c.startsWith('refreshToken='));
      expect(newCookie).not.toBe(refreshTokenCookie);
    });

    it('should return 401 if refresh cookie is missing', async () => {
      const res = await request(app).post('/api/auth/refresh-token');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/ws-ticket', () => {
    it('should return a ticket when authenticated', async () => {
      await User.create({ ...testUser, isEmailVerified: true });
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: testUser.username, password: testUser.password });
      const token = loginRes.body.token;

      const res = await request(app)
        .get('/api/auth/ws-ticket')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.ticket).toBeTruthy();
    });

    it('should return 401 if token is missing', async () => {
      const res = await request(app).get('/api/auth/ws-ticket');
      expect(res.status).toBe(401);
    });

    it('should return 401 if token is invalid', async () => {
      const res = await request(app)
        .get('/api/auth/ws-ticket')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(403); // Middleware returns 403 for invalid
    });
  });

  describe('POST /api/auth/ws-ticket/consume', () => {
    let user, token, doc, ticket;

    beforeEach(async () => {
      user = await User.create({ ...testUser, isEmailVerified: true });
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: testUser.username, password: testUser.password });
      token = loginRes.body.token;

      // Get a ticket
      const ticketRes = await request(app)
        .get('/api/auth/ws-ticket')
        .set('Authorization', `Bearer ${token}`);
      ticket = ticketRes.body.ticket;

      const Document = require('../../src/documents/Document');
      doc = await Document.create({
        title: 'Test Doc',
        owner: user._id,
      });
    });

    it('should consume a valid ticket and verify doc access (bypassing CSRF)', async () => {
      const res = await request(app)
        .post('/api/auth/ws-ticket/consume')
        .send({ ticket, documentId: doc._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.user.id).toBe(user._id.toString());
      expect(res.body.user.username).toBe(user.username);
      expect(res.body.readOnly).toBe(false);
    });

    it('should return 401 for an invalid or already consumed ticket', async () => {
      // Consume it first
      await request(app)
        .post('/api/auth/ws-ticket/consume')
        .send({ ticket, documentId: doc._id.toString() });

      // Try consuming again
      const res = await request(app)
        .post('/api/auth/ws-ticket/consume')
        .send({ ticket, documentId: doc._id.toString() });

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid or expired ticket/i);
    });

    it('should return 403 if the user does not have access to the document', async () => {
      // Create a ticket for a different user
      await User.create({
        username: 'otheruser',
        email: 'other@example.com',
        password: 'Password123!',
        isEmailVerified: true,
      });
      const otherLoginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'otheruser', password: 'Password123!' });
      const otherToken = otherLoginRes.body.token;

      const ticketRes = await request(app)
        .get('/api/auth/ws-ticket')
        .set('Authorization', `Bearer ${otherToken}`);
      const otherTicket = ticketRes.body.ticket;

      const res = await request(app)
        .post('/api/auth/ws-ticket/consume')
        .send({ ticket: otherTicket, documentId: doc._id.toString() });

      expect(res.status).toBe(403);
    });
  });
});
