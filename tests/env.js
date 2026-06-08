const path = require('path');

process.env.JWT_SECRET = 'test-secret-key-123';
process.env.NODE_ENV = 'test';
process.env.ENABLE_EMAIL_VERIFICATION = 'true';
process.env.MONGOMS_DOWNLOAD_DIR =
  process.env.MONGOMS_DOWNLOAD_DIR || path.resolve(__dirname, '../.cache/mongodb-binaries');
