require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../../src/users/User');

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/syncroedit';
console.log('Targeting DB URI:', MONGO_URI);

async function checkUser() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const users = await User.find({
      $or: [{ username: 'tester' }, { email: 'tester@example.com' }],
    });

    if (users.length === 0) {
      console.log('❌ User NOT FOUND in database.');
    } else {
      users.forEach((u) => {
        console.log('✅ User Found:');
        console.log('ID:', u._id);
        console.log('Username:', u.username);
        console.log('Email:', u.email);
        console.log('Verified:', u.isEmailVerified);
        console.log('Password Hash (First 10 chars):', u.password.substring(0, 10) + '...');
        console.log('Login Attempts:', u.loginAttempts);
        console.log('Lock Until:', u.lockUntil);
      });
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkUser();
