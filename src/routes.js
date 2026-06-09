const authRoutes = require('./auth/routes');
const userRoutes = require('./users/routes');
const documentRoutes = require('./documents/routes');

const setupRoutes = (app) => {
  // Health check endpoint (public)
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
    });
  });

  // Public config endpoint
  app.get('/api/config', (req, res) => {
    res.status(200).json({
      emailVerificationEnabled: process.env.ENABLE_EMAIL_VERIFICATION !== 'false',
      realtimeBackend: 'node',
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/documents', documentRoutes);
};

module.exports = setupRoutes;
