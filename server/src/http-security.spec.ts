import {
  allowedFrontendOrigin,
  DEFAULT_FRONTEND_ORIGIN,
} from './http-security';

describe('HTTP security configuration', () => {
  test('uses the Vite development origin by default', () => {
    expect(allowedFrontendOrigin(undefined)).toBe(DEFAULT_FRONTEND_ORIGIN);
    expect(allowedFrontendOrigin('  ')).toBe(DEFAULT_FRONTEND_ORIGIN);
  });

  test('accepts an explicit HTTP or HTTPS origin', () => {
    expect(allowedFrontendOrigin('https://tracker.example.com')).toBe(
      'https://tracker.example.com',
    );
    expect(allowedFrontendOrigin('http://localhost:8081')).toBe(
      'http://localhost:8081',
    );
    expect(allowedFrontendOrigin('https://tracker.example.com/')).toBe(
      'https://tracker.example.com',
    );
  });

  test.each([
    'tracker.example.com',
    'file:///tmp/app',
    'https://example.com/path',
  ])('rejects non-origin value %s', (value) =>
    expect(() => allowedFrontendOrigin(value)).toThrow(),
  );
});
