const authRoutes = require('./auth/routes');
const userRoutes = require('./users/routes');
const documentRoutes = require('./documents/routes');

const setupRoutes = (app) => {
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/documents', documentRoutes);
};

module.exports = setupRoutes;
