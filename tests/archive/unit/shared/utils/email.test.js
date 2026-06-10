const nodemailer = require('nodemailer');

jest.mock('nodemailer');
jest.mock('../../../../src/utils/logger'); // Silence logs
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

describe('Email Utils Unit Tests', () => {
  let mockSendMail;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail = jest.fn().mockResolvedValue(true);
    nodemailer.createTransport.mockReturnValue({
      sendMail: mockSendMail,
    });
  });

  it('should generate a 6 digit code', () => {
    jest.isolateModules(() => {
      const emailUtils = require('../../../../src/utils/email');
      const code = emailUtils.generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    });
  });

  it('should call transporter.sendMail when configured', async () => {
    process.env.ENABLE_EMAIL_VERIFICATION = 'true';
    process.env.SMTP_USER = 'test_user';
    process.env.SMTP_PASS = 'test_pass';
    process.env.SMTP_HOST = 'smtp.test.com';
    delete process.env.RESEND_API_KEY;

    let emailUtils;
    jest.isolateModules(() => {
      emailUtils = require('../../../../src/utils/email');
    });

    await emailUtils.sendVerificationEmail('test@test.com', '123456');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@test.com',
        html: expect.stringContaining('123456'),
      })
    );
  });

  it('should skip sending if verification disabled', async () => {
    process.env.ENABLE_EMAIL_VERIFICATION = 'false';

    let emailUtils;
    jest.isolateModules(() => {
      emailUtils = require('../../../../src/utils/email');
    });

    await emailUtils.sendVerificationEmail('test@test.com', '123456');
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  describe('sendPasswordChangedEmail', () => {
    it('should return true in DEV mode (missing SMTP credentials)', async () => {
      // Ensure SMTP credentials are unset for this test
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      delete process.env.RESEND_API_KEY;

      const emailUtils = require('../../../../src/utils/email');
      const result = await emailUtils.sendPasswordChangedEmail('alert@test.com');

      expect(result).toBe(true);
    });
  });
});
