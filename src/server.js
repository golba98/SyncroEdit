require('dotenv').config();
const express = require('express');
const http = require('http');

const logger = require('./utils/logger');
const globalErrorHandler = require('./middleware/errorMiddleware');
const AppError = require('./utils/AppError');
const setupShutdownHandlers = require('./utils/shutdown');
const setupMiddleware = require('./middleware/setupMiddleware');
const connectDB = require('./config/db');
const setupRoutes = require('./routes');
const documentSocket = require('./documents/socket');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket
const wss = documentSocket.init(server);

// Setup Shutdown and Process Handlers
if (process.env.NODE_ENV !== 'test') {
  setupShutdownHandlers(server, wss);
}

// Setup Middleware
setupMiddleware(app);

// Routes
setupRoutes(app);

// 404 handler
app.all('*splat', (req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handling Middleware
app.use(globalErrorHandler);

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  (async () => {
    // Database Connection
    await connectDB();

    server.listen(PORT, () => {
      logger.info(
        `Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
      );
      logger.info(`Open SyncroEdit: http://localhost:${PORT}`);
    });
  })();
}

module.exports = { app, server, wss };
