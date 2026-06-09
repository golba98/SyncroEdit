const express = require('express');
const router = express.Router();
const authController = require('./authController');
const { authenticateToken } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const isTestOrDev = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';

// Strict limiter for Login/Signup (Brute Force Protection)
const strictAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestOrDev ? 100 : 10, // 10 attempts per 15 mins in prod
  message: { message: 'Too many login/signup attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General limiter for other auth routes (Forgot Password, etc.)
const generalAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTestOrDev ? 100 : 20,
  message: { message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/signup', strictAuthLimiter, authController.signup);
router.post('/check-username', generalAuthLimiter, authController.checkUsername);
router.post('/verify-email', generalAuthLimiter, authController.verifyEmail);
router.post('/resend-code', generalAuthLimiter, authController.resendCode);
router.post('/login', strictAuthLimiter, authController.login);
router.post('/forgot-password', generalAuthLimiter, authController.forgotPassword);
router.post('/reset-password', generalAuthLimiter, authController.resetPassword);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);
router.get('/ws-ticket', authenticateToken, authController.getWsTicket);
router.post('/ws-ticket/consume', authController.consumeWsTicket);
router.get('/csrf-token', authController.getCsrfToken);

module.exports = router;
