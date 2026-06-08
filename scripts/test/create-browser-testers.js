const path = require('path');
// Ensure we load .env from the project root
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const mongoose = require('mongoose');
const User = require('../../src/users/User');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGODB_URI is not defined in environment variables.');
  process.exit(1);
}

// Mask password for logging
const maskedUri = MONGO_URI.replace(/:([^@]+)@/, ':****@');
console.log('Targeting DB URI:', maskedUri);

const usersToCreate = [
  {
    username: 'tester_arc',
    email: 'tester_arc@example.com',
    password: 'TesterPassword123!',
    isEmailVerified: true,
    bio: 'Arc Browser Test User',
  },
  {
    username: 'tester_edge',
    email: 'tester_edge@example.com',
    password: 'TesterPassword123!',
    isEmailVerified: true,
    bio: 'Edge Browser Test User',
  },
];

async function createBrowserTesters() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    for (const userInfo of usersToCreate) {
      let user = await User.findOne({ username: userInfo.username });

      if (user) {
        console.log(`User ${userInfo.username} already exists. Updating...`);
        user.password = userInfo.password;
        user.isEmailVerified = true;
        // Reset lockout
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();
        console.log(`✅ User ${userInfo.username} updated.`);
      } else {
        user = new User(userInfo);
        await user.save();
        console.log(`✅ User ${userInfo.username} created.`);
      }
    }

    // Verification Step
    console.log('\n--- Verification ---');
    const allUsers = await User.find({}, 'username email');
    console.log(`Total Users in DB: ${allUsers.length}`);
    allUsers.forEach((u) => console.log(`- ${u.username} (${u.email})`));
  } catch (error) {
    console.error('❌ Error creating browser test users:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

createBrowserTesters();
