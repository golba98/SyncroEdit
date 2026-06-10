const request = require('supertest');
const { app } = require('../../src/server');
const User = require('../../src/users/User');
const Document = require('../../src/documents/Document');
const mongoose = require('mongoose');

describe('Document Ownership Transfer', () => {
  let token1, userId1, user1;
  let token2, userId2, user2;
  let document;

  beforeEach(async () => {
    // User 1
    const userData1 = {
      username: 'owner_user',
      email: 'owner@example.com',
      password: 'Password123!',
    };
    await request(app).post('/api/auth/signup').send(userData1);
    user1 = await User.findOne({ email: userData1.email });
    userId1 = user1._id;
    // Verify to get token
    user1.isEmailVerified = true;
    user1.verificationCode = null;
    await user1.save();

    // Login to get token
    const res1 = await request(app).post('/api/auth/login').send({
      username: userData1.email,
      password: userData1.password,
    });
    token1 = res1.body.token;

    // User 2
    const userData2 = {
      username: 'target_user',
      email: 'target@example.com',
      password: 'Password123!',
    };
    await request(app).post('/api/auth/signup').send(userData2);
    user2 = await User.findOne({ email: userData2.email });
    userId2 = user2._id;
    user2.isEmailVerified = true;
    await user2.save();

    const res2 = await request(app).post('/api/auth/login').send({
      username: userData2.email,
      password: userData2.password,
    });
    token2 = res2.body.token;

    // Create Document owned by User 1
    document = await Document.create({
      title: 'Transferable Doc',
      owner: userId1,
      pages: [{ content: 'Content' }],
    });
  });

  it('should allow owner to transfer ownership to another user', async () => {
    const res = await request(app)
      .post(`/api/documents/${document._id}/transfer`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ newOwnerUsername: user2.username });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain(user2.username);

    const updatedDoc = await Document.findById(document._id);
    expect(updatedDoc.owner.toString()).toBe(userId2.toString());

    // Check if old owner is now in sharedWith
    const sharedWithString = updatedDoc.sharedWith.map((id) => id.toString());
    expect(sharedWithString).toContain(userId1.toString());
  });

  it('should not allow non-owner to transfer ownership', async () => {
    const res = await request(app)
      .post(`/api/documents/${document._id}/transfer`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ newOwnerUsername: user2.username }); // User 2 trying to take it, or give it to themselves

    expect(res.status).toBe(403);
  });

  it('should fail if target user does not exist', async () => {
    const res = await request(app)
      .post(`/api/documents/${document._id}/transfer`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ newOwnerUsername: 'non_existent_user' });

    expect(res.status).toBe(404);
  });

  it('should fail if new owner is same as current owner', async () => {
    const res = await request(app)
      .post(`/api/documents/${document._id}/transfer`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ newOwnerUsername: user1.username });

    expect(res.status).toBe(400);
  });
});
