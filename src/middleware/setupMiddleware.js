const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const setupMiddleware = (app) => {
  // Security Middleware
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            'cdnjs.cloudflare.com',
            'cdn.quilljs.com',
            'unpkg.com',
            'esm.sh',
            'cdn.jsdelivr.net',
          ],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'cdnjs.cloudflare.com',
            'cdn.quilljs.com',
            'fonts.googleapis.com',
            'cdn.jsdelivr.net',
          ],
          fontSrc: [
            "'self'",
            'cdnjs.cloudflare.com',
            'fonts.gstatic.com',
            'cdn.jsdelivr.net',
            'data:',
          ],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
        },
      },
    })
  );

  app.set('trust proxy', 1);

  // Rate Limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { message: 'Too many requests from this IP, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Body Parsers and Static Files
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));
  app.use(cookieParser());

  const { doubleCsrfProtection } = require('../utils/csrf');

  // Global CSRF protection for non-API, state-changing requests
  app.use((req, res, next) => {
    // Skip CSRF for safe methods
    const method = req.method && req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    // Let the dedicated API CSRF middleware handle /api routes
    if (req.path && req.path.startsWith('/api/')) {
      return next();
    }

    // Apply CSRF protection to other state-changing routes
    return doubleCsrfProtection(req, res, next);
  });

  // Apply CSRF protection to all API routes
  app.use('/api/', (req, res, next) => {
    if (
      req.path === '/auth/ws-ticket/consume' ||
      req.path === '/api/auth/ws-ticket/consume' ||
      req.path.startsWith('/internal/')
    ) {
      return next();
    }
    return doubleCsrfProtection(req, res, next);
  });

  // Apply limiter to API routes
  app.use('/api/', apiLimiter);
};

module.exports = setupMiddleware;
