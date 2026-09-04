import { SessionTokenService } from './session-token.service';

describe('SessionTokenService', () => {
  const tokens = new SessionTokenService();

  test('generates independent 256-bit base64url tokens', () => {
    const generated = new Set(
      Array.from({ length: 32 }, () => tokens.generate()),
    );
    expect(generated.size).toBe(32);
    for (const token of generated) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(tokens.valid(token)).toBe(true);
    }
  });

  test('hashes tokens deterministically without preserving the raw token', () => {
    const token = tokens.generate();
    const first = tokens.hash(token);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(tokens.hash(token));
    expect(first).not.toContain(token);
  });

  test.each([
    null,
    undefined,
    '',
    'not+base64/url',
    'a'.repeat(42),
    'a'.repeat(44),
  ])('rejects malformed raw token %#', (token) =>
    expect(tokens.valid(token)).toBe(false),
  );
});
