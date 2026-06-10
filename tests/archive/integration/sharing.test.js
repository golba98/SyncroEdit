const request = require('supertest');
const { app } = require('../../src/server');
const User = require('../../src/users/User');
const Document = require('../../src/documents/Document');
const mongoose = require('mongoose');

describe('Document Sharing Integration Tests', () => {
  let ownerToken;
  let ownerId;
  let otherToken;
  let otherId;
  let docId;

  const ownerUser = {
    username: 'owner_share',
    email: 'owner_share@example.com',
    password: 'TestPassword123!',
  };

  const otherUser = {
    username: 'other_share',
    email: 'other_share@example.com',
    password: 'TestPassword123!',
  };

  beforeEach(async () => {
    // Setup Owner
    await request(app).post('/api/auth/signup').send(ownerUser);
    const user1 = await User.findOne({ email: ownerUser.email });
    ownerId = user1._id;
    const verifyRes1 = await request(app).post('/api/auth/verify-email').send({
      email: ownerUser.email,
      verificationCode: user1.verificationCode,
    });
    ownerToken = verifyRes1.body.token;

    // Setup Other User
    await request(app).post('/api/auth/signup').send(otherUser);
    const user2 = await User.findOne({ email: otherUser.email });
    otherId = user2._id;
    const verifyRes2 = await request(app).post('/api/auth/verify-email').send({
      email: otherUser.email,
      verificationCode: user2.verificationCode,
    });
    otherToken = verifyRes2.body.token;

    // Create Document
    const docRes = await request(app)
      .post('/api/documents')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Shared Doc' });
    docId = docRes.body._id;
  });

  describe('GET /api/documents/:id/settings', () => {
    it('should allow owner to view settings', async () => {
      const res = await request(app)
        .get(`/api/documents/${docId}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isOwner).toBe(true);
      expect(res.body.isPublic).toBe(false); // Default
    });

    it('should deny non-owner view settings if private', async () => {
      const res = await request(app)
        .get(`/api/documents/${docId}/settings`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/documents/:id/settings', () => {
    it('should allow owner to update settings', async () => {
      const res = await request(app)
        .patch(`/api/documents/${docId}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ isPublic: true });

      expect(res.status).toBe(200);
      expect(res.body.isPublic).toBe(true);

      const doc = await Document.findById(docId);
      expect(doc.isPublic).toBe(true);
    });

    it('should deny non-owner update settings', async () => {
      const res = await request(app)
        .patch(`/api/documents/${docId}/settings`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ isPublic: true });

      expect(res.status).toBe(403);
    });
  });

  describe('Public Access Logic', () => {
    it('should allow access to public document for non-collaborators', async () => {
      // 1. Make public
      await Document.findByIdAndUpdate(docId, { isPublic: true });

      // 2. Try to add to recent (which checks access)
      const res = await request(app)
        .post(`/api/documents/${docId}/recent`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
    });

    it('should deny access to private document for non-collaborators', async () => {
      // 1. Ensure private (default)
      await Document.findByIdAndUpdate(docId, { isPublic: false });

      // 2. Try to add to recent
      const res = await request(app)
        .post(`/api/documents/${docId}/recent`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(403);
    });

    it('should allow viewing settings if public', async () => {
      // 1. Make public
      await Document.findByIdAndUpdate(docId, { isPublic: true });

      const res = await request(app)
        .get(`/api/documents/${docId}/settings`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      expect(res.body.isPublic).toBe(true);
      expect(res.body.isOwner).toBe(false);
    });
  });
});
