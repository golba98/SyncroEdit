const request = require('supertest');
const { app } = require('../../src/server');
const User = require('../../src/users/User');
const Document = require('../../src/documents/Document');
const mongoose = require('mongoose');

describe('Document Integration Tests', () => {
  let token;
  let userId;
  const testUser = {
    username: 'testuser_doc',
    email: 'test_doc@example.com',
    password: 'TestPassword123!',
  };

  beforeEach(async () => {
    await request(app).post('/api/auth/signup').send(testUser);
    const user = await User.findOne({ email: testUser.email });
    userId = user._id;

    const verifyRes = await request(app).post('/api/auth/verify-email').send({
      email: testUser.email,
      verificationCode: user.verificationCode,
    });
    token = verifyRes.body.token;
  });

  describe('POST /api/documents', () => {
    it('should create a new document successfully', async () => {
      const docData = { title: 'Test Document' };

      const res = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${token}`)
        .send(docData);

      expect(res.status).toBe(201);
      expect(res.body.title).toBe(docData.title);
    });

    it('should return 400 if title is missing (if validation exists) or just create default', async () => {
      // Our controller currently defaults title to 'Untitled document' if missing
      const res = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Untitled document');
    });
  });

  describe('GET /api/documents (Pagination)', () => {
    it('should paginate documents', async () => {
      // Create 15 documents
      const docs = Array.from({ length: 15 }, (_, i) => ({
        title: `Doc ${i}`,
        owner: userId,
      }));
      await Document.create(docs);

      const res = await request(app)
        .get('/api/documents?page=1&limit=10')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.documents.length).toBe(10);
      expect(res.body.pagination.totalPages).toBe(2);
      expect(res.body.pagination.currentPage).toBe(1);

      const res2 = await request(app)
        .get('/api/documents?page=2&limit=10')
        .set('Authorization', `Bearer ${token}`);

      expect(res2.status).toBe(200);
      expect(res2.body.documents.length).toBe(5);
    });

    it('should include ownership status in document list', async () => {
      const otherUser = await User.create({
        username: 'other_owner',
        email: 'other_owner@test.com',
        password: 'Password123!',
      });

      // Create owned document
      await Document.create({ title: 'My Doc', owner: userId });

      // Create shared document
      await Document.create({
        title: 'Shared Doc',
        owner: otherUser._id,
        sharedWith: [userId],
      });

      const res = await request(app).get('/api/documents').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.documents.length).toBe(2);

      const ownedDoc = res.body.documents.find((d) => d.title === 'My Doc');
      const sharedDoc = res.body.documents.find((d) => d.title === 'Shared Doc');

      expect(ownedDoc.isOwner).toBe(true);
      expect(ownedDoc.isShared).toBe(false);

      expect(sharedDoc.isOwner).toBe(false);
      expect(sharedDoc.isShared).toBe(true);
    });
  });

  describe('DELETE /api/documents/:id', () => {
    it('should delete a document successfully', async () => {
      const doc = await Document.create({ title: 'Delete Me', owner: userId });

      const res = await request(app)
        .delete(`/api/documents/${doc._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('deleted');

      const foundDoc = await Document.findById(doc._id);
      expect(foundDoc).toBeNull();
    });

    it('should return 404 if document does not exist', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .delete(`/api/documents/${fakeId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it("should return 403 if trying to delete someone else's document who hasn't shared it", async () => {
      const otherUser = await User.create({
        username: 'other',
        email: 'other@test.com',
        password: 'Password123!',
      });
      const doc = await Document.create({ title: 'Other Doc', owner: otherUser._id });

      const res = await request(app)
        .delete(`/api/documents/${doc._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('should remove shared document from user drive instead of deleting', async () => {
      const otherUser = await User.create({
        username: 'sharer',
        email: 'sharer@test.com',
        password: 'Password123!',
      });
      const doc = await Document.create({
        title: 'Shared Doc',
        owner: otherUser._id,
        sharedWith: [userId],
      });

      // Add to recent documents
      const user = await User.findById(userId);
      user.recentDocuments = [doc._id];
      await user.save();

      const res = await request(app)
        .delete(`/api/documents/${doc._id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.action).toBe('removed');
      expect(res.body.message).toContain('Removed from your drive');

      // Document should still exist
      const foundDoc = await Document.findById(doc._id);
      expect(foundDoc).not.toBeNull();

      // Should be removed from user's recent documents
      const updatedUser = await User.findById(userId);
      expect(updatedUser.recentDocuments).toEqual([]);
    });

    it('should only allow owner to permanently delete, not shared users', async () => {
      const otherUser = await User.create({
        username: 'owner2',
        email: 'owner2@test.com',
        password: 'Password123!',
      });
      const doc = await Document.create({
        title: 'Owner Doc',
        owner: otherUser._id,
        sharedWith: [userId],
      });

      // Try to delete as shared user (not owner)
      const res = await request(app)
        .delete(`/api/documents/${doc._id}`)
        .set('Authorization', `Bearer ${token}`);

      // Should remove from drive, not delete
      expect(res.status).toBe(200);
      expect(res.body.action).toBe('removed');

      // Document should still exist
      const foundDoc = await Document.findById(doc._id);
      expect(foundDoc).not.toBeNull();
      expect(foundDoc.owner.toString()).toBe(otherUser._id.toString());
    });
  });

  describe('Error Handling & Auth', () => {
    it('should return 401 if no token provided', async () => {
      const res = await request(app).get('/api/documents');
      expect(res.status).toBe(401);
    });

    it('should return 403 if token is invalid', async () => {
      const res = await request(app)
        .get('/api/documents')
        .set('Authorization', 'Bearer invalidtoken');
      expect(res.status).toBe(403);
    });
  });
});
