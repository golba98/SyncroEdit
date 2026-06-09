const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const User = require('../users/User');
const emailUtils = require('../utils/email');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { createTicket } = require('../utils/ticketStore');
const { generateToken } = require('../utils/csrf');

const JWT_SECRET = process.env.JWT_SECRET;
const EMAIL_VERIFICATION_ENABLED = process.env.ENABLE_EMAIL_VERIFICATION !== 'false';

// Pre-calculated dummy hash for timing attack mitigation (matches bcrypt cost)
const DUMMY_HASH = '$2a$10$K9p/9.tW2m2.8.8.8.8.8.8.8.8.8.8.8.8.8.8.8.8.8.8.8.8.';

/**
 * Validates password complexity against the shared policy.
 * Throws AppError if validation fails.
 */
const validatePasswordComplexity = (password) => {
  // Min 8 chars, 1 Upper, 1 Lower, 1 Number, 1 Symbol
  if (!User.PASSWORD_REGEX.test(password)) {
    throw new AppError(
      'Password must be at least 8 characters long and include at least one uppercase letter, one lowercase letter, one number, and one symbol (!@#$%^&*).',
      400
    );
  }
};

/**
 * Ensures a minimum response time to mitigate timing attacks.
 * Adds a small amount of jitter to prevent statistical analysis.
 */
const ensureMinimumDelay = async (startTime, minDelayMs = 800) => {
  const elapsed = Date.now() - startTime;
  const remaining = minDelayMs - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining + Math.random() * 200));
  }
};

/**
 * Constant-time string comparison to prevent timing attacks.
 */
const timingSafeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Dummy comparison to keep timing more consistent
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Helper to generate tokens, create session, and send response
 */
const sendTokens = async (user, statusCode, req, res, message = undefined) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const refreshToken = jwt.sign(
    { id: user._id, sessionId, jti: crypto.randomBytes(8).toString('hex') },
    JWT_SECRET,
    {
      expiresIn: '7d',
    }
  );

  const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

  user.sessions.push({
    sessionId,
    refreshToken: hashedToken,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
    lastActive: new Date(),
  });

  // Keep only last 5 sessions
  if (user.sessions.length > 5) {
    user.sessions.shift();
  }

  await user.save();

  const accessToken = jwt.sign({ id: user._id, username: user.username, sessionId }, JWT_SECRET, {
    expiresIn: '15m',
  });

  // Send Refresh Token as HTTP-Only Cookie
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  const response = {
    token: accessToken,
    username: user.username,
    email: user.email,
  };
  if (message) response.message = message;

  res.status(statusCode).json(response);
};

exports.checkUsername = async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return next(new AppError('Database connection error', 500));
  }
  try {
    const { username } = req.body;
    if (!username) return next(new AppError('Username is required', 400));

    const user = await User.findOne({ username: username.trim() }).lean();
    if (user) {
      // Suggest alternatives
      const suggestions = [
        `${username}${Math.floor(Math.random() * 99)}`,
        `${username}_edit`,
        `sync_${username}`,
      ];
      return res.json({ available: false, suggestions });
    }
    res.json({ available: true });
  } catch (err) {
    next(err);
  }
};

exports.getWsTicket = (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      logger.warn('getWsTicket called without valid user session');
      return next(new AppError('Authentication required', 401));
    }

    const userId = req.user.id;
    const ticket = createTicket(userId);

    logger.debug(`Generated WS ticket for user ${userId}`);
    res.json({ ticket });
  } catch (err) {
    logger.error('Error generating WS ticket:', err);
    next(err);
  }
};

exports.consumeWsTicket = async (req, res, next) => {
  try {
    const { ticket, documentId } = req.body;
    if (!ticket || !documentId) {
      return next(new AppError('Ticket and documentId are required', 400));
    }

    const { verifyTicket } = require('../utils/ticketStore');
    const userId = verifyTicket(ticket);
    if (!userId) {
      return next(new AppError('Invalid or expired ticket', 401));
    }

    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 401));
    }

    const Document = require('../documents/Document');
    const dbDoc = await Document.findById(documentId);
    if (!dbDoc) {
      return next(new AppError('Document not found', 404));
    }

    const isOwner = dbDoc.owner.toString() === userId;
    const isShared = dbDoc.sharedWith && dbDoc.sharedWith.some((id) => id.toString() === userId);
    const isViewer = dbDoc.viewers && dbDoc.viewers.some((id) => id.toString() === userId);
    const isPublic = dbDoc.isPublic === true;

    if (!isOwner && !isShared && !isViewer && !isPublic) {
      return next(new AppError('Forbidden', 403));
    }

    const readOnly = isViewer && !isOwner && !isShared;

    logger.debug(`Successfully consumed ticket for user ${userId} on doc ${documentId}`);
    res.json({
      ok: true,
      user: {
        id: user._id.toString(),
        username: user.username,
      },
      readOnly,
    });
  } catch (err) {
    logger.error('Error consuming WS ticket:', err);
    next(err);
  }
};

exports.getCsrfToken = (req, res) => {
  const token = generateToken(req, res);
  res.json({ csrfToken: token });
};

exports.signup = async (req, res, next) => {
  const startTime = Date.now();
  if (mongoose.connection.readyState !== 1) {
    return next(new AppError('Database connection error', 500));
  }

  let { username, email, password } = req.body;

  if (!username || !email || !password) {
    return next(new AppError('Please provide username, email, and password', 400));
  }

  // Password Complexity Policy
  try {
    validatePasswordComplexity(password);
  } catch (err) {
    return next(err);
  }

  username = username.trim();
  email = email.trim().toLowerCase();

  const existingByUsername = await User.findOne({ username }).lean();
  if (existingByUsername) {
    await ensureMinimumDelay(startTime, 300);
    return next(new AppError('Username is already taken.', 409));
  }

  const existingByEmail = await User.findOne({ email }).lean();
  if (existingByEmail) {
    await ensureMinimumDelay(startTime, 300);
    return next(new AppError('Email is already registered.', 409));
  }

  const verificationCode = emailUtils.generateVerificationCode();
  const user = new User({
    username,
    email,
    password,
    verificationCode: EMAIL_VERIFICATION_ENABLED ? verificationCode : null,
    verificationCodeExpires: EMAIL_VERIFICATION_ENABLED
      ? new Date(Date.now() + 10 * 60 * 1000)
      : null,
    isEmailVerified: !EMAIL_VERIFICATION_ENABLED,
  });
  await user.save();

  if (EMAIL_VERIFICATION_ENABLED) {
    const emailSent = await emailUtils.sendVerificationEmail(email, verificationCode);
    if (!emailSent) {
      await User.deleteOne({ _id: user._id });
      return next(new AppError('Failed to send verification email', 500));
    }
    logger.info(`New user signed up (pending verification): ${user.username}`);
    res.status(200).json({
      message: 'If your email is not registered, you will receive a verification code.',
    });
  } else {
    logger.info(`New user signed up: ${user.username}`);
    await sendTokens(user, 201, req, res, 'Signup successful (verification disabled).');
  }
};

exports.verifyEmail = async (req, res, next) => {
  const startTime = Date.now();
  const { email, verificationCode } = req.body;

  const user = await User.findOne({ email });
  // Prevent user enumeration by returning generic error
  if (!user) {
    await ensureMinimumDelay(startTime, 500);
    return next(new AppError('Invalid verification code', 400));
  }

  if (!EMAIL_VERIFICATION_ENABLED) {
    user.isEmailVerified = true;
    user.verificationCode = null;
    user.verificationCodeExpires = null;
    await user.save();
    return await sendTokens(user, 200, req, res, 'Verification disabled; user marked verified.');
  }

  if (user.isEmailVerified) {
    return await sendTokens(user, 200, req, res, 'Email already verified');
  }

  if (!user.verificationCode || !timingSafeCompare(user.verificationCode, verificationCode)) {
    await ensureMinimumDelay(startTime, 500);
    return next(new AppError('Invalid verification code', 400));
  }

  if (new Date() > user.verificationCodeExpires) {
    return next(new AppError('Verification code expired', 400));
  }

  user.isEmailVerified = true;
  user.verificationCode = null;
  user.verificationCodeExpires = null;

  logger.info(`User email verified: ${user.username}`);
  await sendTokens(user, 200, req, res, 'Email verified successfully');
};

exports.resendCode = async (req, res, next) => {
  const startTime = Date.now();
  if (!EMAIL_VERIFICATION_ENABLED) {
    return res.status(200).json({ message: 'Verification disabled; no code sent.' });
  }

  const { email } = req.body;
  if (!email) return next(new AppError('Please provide an email address', 400));
  if (typeof email !== 'string') {
    return next(new AppError('Invalid email address format', 400));
  }

  const user = await User.findOne({ email });
  if (!user) {
    // Prevent enumeration: Return generic message even if email not found
    await ensureMinimumDelay(startTime, 800);
    return res.status(200).json({
      message: 'If your email is registered, you will receive a new verification code.',
    });
  }

  if (user.isEmailVerified) {
    return next(new AppError('Email already verified', 400));
  }

  const verificationCode = emailUtils.generateVerificationCode();
  user.verificationCode = verificationCode;
  user.verificationCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
  await user.save();

  const emailSent = await emailUtils.sendVerificationEmail(email, verificationCode);
  if (!emailSent) {
    return next(new AppError('Failed to send email', 500));
  }

  logger.info(`Verification code resent to: ${email}`);
  res.json({ message: 'If your email is registered, a code has been sent.' });
};

exports.login = async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return next(new AppError('Database connection error', 500));
  }

  let { username, password } = req.body;
  if (username) username = username.trim();
  if (password) password = password.trim();

  // Find user by username OR email
  // The frontend sends 'username' field, but user might type email there.
  const user = await User.findOne({
    $or: [{ username: username }, { email: username.toLowerCase() }],
  });

  if (!user) {
    // Mitigate timing attack by performing a dummy hash comparison
    await bcrypt.compare(password, DUMMY_HASH);
    return next(new AppError('Invalid username or password', 401));
  }

  // Account Lockout Check
  if (user.lockUntil && user.lockUntil > Date.now()) {
    return next(
      new AppError(
        'Account is temporarily locked due to multiple failed login attempts. Please try again later.',
        403
      )
    );
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    // Increment failed attempts
    user.loginAttempts += 1;

    if (user.loginAttempts >= 5) {
      user.lockUntil = Date.now() + 15 * 60 * 1000; // Lock for 15 minutes
      await user.save();
      return next(
        new AppError(
          'Account locked due to too many failed attempts. Try again in 15 minutes.',
          403
        )
      );
    }

    await user.save();
    return next(new AppError('Invalid username or password', 401));
  }

  // Reset login attempts on success
  if (user.loginAttempts !== 0 || user.lockUntil) {
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();
  }

  if (!user.isEmailVerified) {
    if (!EMAIL_VERIFICATION_ENABLED) {
      user.isEmailVerified = true;
      user.verificationCode = null;
      user.verificationCodeExpires = null;
      await user.save();
    } else {
      const verificationCode = emailUtils.generateVerificationCode();
      user.verificationCode = verificationCode;
      user.verificationCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();

      emailUtils.sendVerificationEmail(user.email, verificationCode).catch((err) => {
        logger.error('Deferred verification email failed:', err);
      });

      return res.status(403).json({
        message: 'Email not verified. We just sent a fresh code.',
        requiresVerification: true,
        email: user.email,
        username: user.username,
      });
    }
  }

  logger.info(`User logged in: ${user.username}`);

  // Update Login History
  user.loginHistory.unshift(new Date());
  if (user.loginHistory.length > 5) {
    user.loginHistory.pop();
  }
  await user.save();

  await sendTokens(user, 200, req, res);
};

exports.logout = async (req, res, next) => {
  const refreshToken = req.cookies?.refreshToken;
  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (user) {
        user.sessions = user.sessions.filter((s) => s.sessionId !== decoded.sessionId);
        await user.save();
      }
    } catch (err) {
      // Token might be invalid or expired, just proceed to clear cookie
    }
  }

  res.clearCookie('refreshToken');
  res.status(200).json({ message: 'Logged out successfully' });
};

exports.revokeSession = async (req, res, next) => {
  const { sessionId } = req.params;
  const user = await User.findById(req.user.id);
  if (!user) return next(new AppError('User not found', 404));

  user.sessions = user.sessions.filter((s) => s.sessionId !== sessionId);
  await user.save();

  res.status(200).json({ message: 'Session revoked' });
};

exports.revokeAllOtherSessions = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user) return next(new AppError('User not found', 404));

  // req.user.sessionId is set by the authenticateToken middleware (we'll update that next)
  user.sessions = user.sessions.filter((s) => s.sessionId === req.user.sessionId);
  await user.save();

  res.status(200).json({ message: 'All other sessions revoked' });
};

exports.refreshToken = async (req, res, next) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    logger.debug('Refresh token missing in cookies');
    return res.status(401).json({ message: 'Refresh token not found, please login again.' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      logger.warn(`Refresh token user not found: ${decoded.id}`);
      return res.status(401).json({ message: 'User no longer exists.' });
    }

    // Validate session
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const sessionIndex = user.sessions.findIndex(
      (s) => s.sessionId === decoded.sessionId && s.refreshToken === hashedToken
    );

    if (sessionIndex === -1) {
      // Theft Detection: If we have a valid JWT but no matching DB session,
      // it means this token was already rotated (used).
      // Potential theft! Revoke all sessions for this family (or user).

      // For now, let's just Log and Block.
      logger.warn(
        `Potential Token Theft detected for user ${user.username}. Session ID: ${decoded.sessionId}`
      );

      // Optional: Revoke that specific session ID entirely if it exists with a different token
      user.sessions = user.sessions.filter((s) => s.sessionId !== decoded.sessionId);
      await user.save();

      return res.status(403).json({ message: 'Session expired or revoked.' });
    }

    // Token Rotation: Generate NEW Refresh Token
    const newRefreshToken = jwt.sign(
      { id: user._id, sessionId: decoded.sessionId, jti: crypto.randomBytes(8).toString('hex') },
      JWT_SECRET,
      {
        expiresIn: '7d',
      }
    );
    const newHashedToken = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    // Update Session
    user.sessions[sessionIndex].refreshToken = newHashedToken;
    user.sessions[sessionIndex].lastActive = new Date();
    user.sessions[sessionIndex].ipAddress = req.ip;

    await user.save();

    // Issue new Access Token
    const accessToken = jwt.sign(
      { id: user._id, username: user.username, sessionId: decoded.sessionId },
      JWT_SECRET,
      {
        expiresIn: '15m',
      }
    );

    // Send NEW Refresh Token as HTTP-Only Cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ token: accessToken });
  } catch (err) {
    logger.error('Refresh token error:', err);
    return res.status(403).json({ message: 'Invalid refresh token' });
  }
};

exports.forgotPassword = async (req, res, next) => {
  const startTime = Date.now();
  const { email } = req.body;
  if (!email) return next(new AppError('Please provide an email address', 400));

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    // Prevent enumeration: Simulate delay to match hashing + DB write + email sending
    await ensureMinimumDelay(startTime, 800);
    return res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
  }

  // Generate Token
  const resetToken = crypto.randomBytes(32).toString('hex');

  // Hash token and save to DB
  user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  await user.save({ validateBeforeSave: false });

  // Create Reset URL — fall back to request host in dev if FRONTEND_URL is not configured
  const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
  const resetUrl = `${baseUrl}/pages/reset-password.html?token=${resetToken}`;

  try {
    await emailUtils.sendPasswordResetEmail(user.email, resetUrl);
    res.status(200).json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new AppError('There was an error sending the email. Try again later!'), 500);
  }
};

exports.resetPassword = async (req, res, next) => {
  const { token, password, username } = req.body;
  if (!token || !password || !username)
    return next(new AppError('Token, username, and new password are required', 400));

  // Hash the token to compare with DB
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  // Helper to invalidate token and return error
  const invalidateAndError = async (message) => {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    return next(new AppError(message, 400));
  };

  // Username confirmation check (Anti-bot / Knowledge Check)
  if (user.username !== username.trim()) {
    return await invalidateAndError(
      'Username confirmation failed. Please ensure you entered the correct username.'
    );
  }

  // MFA Check
  if (user.mfaEnabled) {
    const { mfaCode } = req.body;
    if (!mfaCode) {
      return res.status(400).json({
        status: 'fail',
        message: 'Two-factor authentication code is required for this account.',
        mfaRequired: true,
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: mfaCode,
    });

    if (!verified) {
      return await invalidateAndError('Invalid two-factor authentication code.');
    }
  }

  // Password complexity check
  try {
    validatePasswordComplexity(password);
  } catch (err) {
    return await invalidateAndError(err.message);
  }

  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  // Unlock account if it was locked (optional: nice UX)
  user.loginAttempts = 0;
  user.lockUntil = undefined;

  // Security: Revoke all existing sessions (log out all devices)
  user.sessions = [];

  await user.save();

  // Security Alert: Notify user of password change
  emailUtils.sendPasswordChangedEmail(user.email).catch((err) => {
    logger.error(`Failed to send password change alert to ${user.email}`, err);
  });

  // Do NOT log the user in immediately. Require manual login.
  res
    .status(200)
    .json({ message: 'Password reset successful. Please log in with your new password.' });
};
