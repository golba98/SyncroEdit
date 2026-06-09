import {
  __clearRateLimitBucketsForTests,
  edgeRateLimit,
  getRateLimitCategory,
  isEdgeRateLimitingEnabled,
} from '../../../worker/src/middleware/rateLimit.js';

describe('Worker edge rate limit', () => {
  afterEach(() => {
    __clearRateLimitBucketsForTests();
  });

  it('classifies strict, auth-sensitive, and default routes', () => {
    expect(getRateLimitCategory('/api/node/auth/login')).toBe('strict');
    expect(getRateLimitCategory('/api/node/auth/ws-ticket')).toBe('strict');
    expect(getRateLimitCategory('/api/node/user/profile')).toBe('authSensitive');
    expect(getRateLimitCategory('/api/node/documents')).toBe('authSensitive');
    expect(getRateLimitCategory('/api/node/auth/csrf-token')).toBe('default');
  });

  it('is disabled unless explicitly enabled', () => {
    expect(isEdgeRateLimitingEnabled({ EDGE_RATE_LIMITING_ENABLED: 'false' })).toBe(false);
    expect(isEdgeRateLimitingEnabled({ EDGE_RATE_LIMITING_ENABLED: 'true' })).toBe(true);
  });

  it('passes through when disabled', async () => {
    const next = jest.fn();

    await edgeRateLimit(
      {
        env: { EDGE_RATE_LIMITING_ENABLED: 'false' },
        req: { path: '/api/node/auth/login', header: jest.fn() },
        header: jest.fn(),
      },
      next
    );

    expect(next).toHaveBeenCalled();
  });

  it('returns 429 and Retry-After header when limit exceeded', async () => {
    const next = jest.fn();
    const headers = {};
    const mockContext = {
      env: { EDGE_RATE_LIMITING_ENABLED: 'true' },
      req: {
        path: '/api/node/auth/login', // strict category (limit = 20)
        header: jest.fn().mockReturnValue('127.0.0.1'),
      },
      header: jest.fn().mockImplementation((key, val) => {
        headers[key] = val;
      }),
      json: jest.fn().mockImplementation((body, status) => {
        return { status, body };
      }),
    };

    // Trigger 20 requests (under limit)
    for (let i = 0; i < 20; i++) {
      await edgeRateLimit(mockContext, next);
    }
    expect(next).toHaveBeenCalledTimes(20);

    // Trigger 21st request (exceeds limit)
    const res = await edgeRateLimit(mockContext, next);
    expect(next).toHaveBeenCalledTimes(20); // Not called again
    expect(headers['Retry-After']).toBeDefined();
    expect(parseInt(headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(res).toBeDefined();
    expect(res.status).toBe(429);
  });
});
