const { generateCode } = require('../../src-worker/emailVerification.js');

describe('email verification code generation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('generates six digit numeric verification codes', () => {
    expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('retries random values that would bias the verification code range', () => {
    const getRandomValues = jest
      .spyOn(global.crypto, 'getRandomValues')
      .mockImplementationOnce((array) => {
        array[0] = 0xffffffff;
        return array;
      })
      .mockImplementationOnce((array) => {
        array[0] = 42;
        return array;
      });

    expect(generateCode()).toBe('000042');
    expect(getRandomValues).toHaveBeenCalledTimes(2);
  });
});
