/**
 * @jest-environment jsdom
 */

import { normalizeVerificationUser } from '/js/features/auth/auth.js';

jest.mock('/js/app/network.js', () => ({
  Network: {
    fetchAPI: jest.fn(),
  },
}));

describe('normalizeVerificationUser', () => {
  it('treats falsy canonical email_verified_at values as unverified', () => {
    expect(normalizeVerificationUser({ email_verified_at: 0, isEmailVerified: true })).toEqual(
      expect.objectContaining({
        emailVerified: false,
        isEmailVerified: false,
      })
    );
    expect(normalizeVerificationUser({ email_verified_at: '', emailVerified: true })).toEqual(
      expect.objectContaining({
        emailVerified: false,
        isEmailVerified: false,
      })
    );
  });

  it('keeps legacy mirror fallback only when canonical timestamp is absent', () => {
    expect(normalizeVerificationUser({ isEmailVerified: 1 })).toEqual(
      expect.objectContaining({
        emailVerified: true,
        isEmailVerified: true,
      })
    );
  });
});
