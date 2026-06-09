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
});
