const authRoutes = require('./auth/routes');
const userRoutes = require('./users/routes');
const documentRoutes = require('./documents/routes');
const documentController = require('./documents/documentController');

const setupRoutes = (app) => {
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/documents', documentRoutes);
  app.post('/api/internal/documents/:documentId/yjs-state', documentController.updateYjsState);
};

module.exports = setupRoutes;
