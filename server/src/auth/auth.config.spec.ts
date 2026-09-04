import {
  DEFAULT_SESSION_TTL_SECONDS,
  MAX_PASSWORD_LENGTH,
  MAX_SESSION_TTL_SECONDS,
  MIN_PASSWORD_LENGTH,
  MIN_SESSION_TTL_SECONDS,
  normalizeEmail,
  sessionTtlSeconds,
  validatePassword,
} from './auth.config';

describe('authentication configuration and input policy', () => {
  test('uses the documented fixed session lifetime by default', () => {
    expect(sessionTtlSeconds({})).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  test.each([
    ['300', MIN_SESSION_TTL_SECONDS],
    ['604800', DEFAULT_SESSION_TTL_SECONDS],
    [String(MAX_SESSION_TTL_SECONDS), MAX_SESSION_TTL_SECONDS],
  ])('accepts bounded integer TTL %s', (configured, expected) => {
    expect(sessionTtlSeconds({ HOI4_SESSION_TTL_SECONDS: configured })).toBe(
      expected,
    );
  });

  test.each(['0', '-1', '299', '1.5', 'seconds', '31536001'])(
    'rejects invalid or unreasonable TTL %s',
    (configured) => {
      expect(() =>
        sessionTtlSeconds({ HOI4_SESSION_TTL_SECONDS: configured }),
      ).toThrow('HOI4_SESSION_TTL_SECONDS');
    },
  );

  test('normalizes email without inventing domain rewriting', () => {
    expect(normalizeEmail('  User.Name+HOI4@Example.COM  ')).toBe(
      'user.name+hoi4@example.com',
    );
  });

  test.each([undefined, null, '', 'missing-at.example.com', '@example.com'])(
    'rejects invalid email input %#',
    (value) => expect(() => normalizeEmail(value)).toThrow('valid email'),
  );

  test('accepts passwords at both documented length bounds', () => {
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toHaveLength(
      MIN_PASSWORD_LENGTH,
    );
    expect(validatePassword('a'.repeat(MAX_PASSWORD_LENGTH))).toHaveLength(
      MAX_PASSWORD_LENGTH,
    );
  });

  test.each([
    undefined,
    '',
    ' '.repeat(MIN_PASSWORD_LENGTH),
    'a'.repeat(MIN_PASSWORD_LENGTH - 1),
    'a'.repeat(MAX_PASSWORD_LENGTH + 1),
  ])('rejects unsafe password input %#', (value) => {
    expect(() => validatePassword(value)).toThrow('Password must be between');
  });
});
