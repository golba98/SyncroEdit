/**
 * @jest-environment jsdom
 */

import { normalizeVerificationUser } from '/js/features/auth/auth.js';

describe('normalizeVerificationUser', () => {
  it('uses email_verified_at as the verification source of truth', () => {
    expect(
      normalizeVerificationUser({
        email_verified_at: 1782162112,
        emailVerified: false,
        isEmailVerified: false,
      })
    ).toEqual(
      expect.objectContaining({
        emailVerified: true,
        isEmailVerified: true,
      })
    );
  });

  it('does not treat legacy or frontend-only flags as verified without email_verified_at', () => {
    const cases = [
      {},
      { emailVerified: true },
      { isEmailVerified: true },
      { isEmailVerified: 1 },
      { emailVerified: 'true' },
      { isEmailVerified: '1' },
      { email_verified_at: null, emailVerified: true, isEmailVerified: true },
    ];

    cases.forEach((user) => {
      expect(normalizeVerificationUser(user)).toEqual(
        expect.objectContaining({
          emailVerified: false,
          isEmailVerified: false,
        })
      );
    });
  });
});
