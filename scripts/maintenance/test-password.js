require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../../src/users/User');

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/syncroedit';

console.log('Connecting to:', MONGO_URI);

async function testPassword() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const username = 'tester';
    const password = 'password123';

    const user = await User.findOne({
      $or: [{ username: username }, { email: username.toLowerCase() }],
    });

    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`User found: ${user.username}`);
    console.log('Stored Hash:', user.password);

    const isMatch = await user.comparePassword(password);

    if (isMatch) {
      console.log('✅ Password Match! Login should succeed.');
    } else {
      console.log('❌ Password Mismatch!');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

testPassword();
