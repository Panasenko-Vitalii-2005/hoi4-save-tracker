import {
  allowedFrontendOrigin,
  configureHttpSecurity,
  DEFAULT_FRONTEND_ORIGIN,
} from './http-security';
import type { INestApplication } from '@nestjs/common';

describe('HTTP security configuration', () => {
  test('exposes persistence outcome and hash without weakening credentialed CORS', () => {
    const enableCors = jest.fn();
    configureHttpSecurity({
      enableCors,
      use: jest.fn(),
      getHttpAdapter: () => ({ getInstance: () => ({ set: jest.fn() }) }),
      get: () => ({ middleware: jest.fn() }),
    } as unknown as INestApplication);
    expect(enableCors).toHaveBeenCalledWith({
      origin: allowedFrontendOrigin(),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      exposedHeaders: [
        'X-Analysis-Hash',
        'X-Analysis-Persistence',
        'Retry-After',
      ],
    });
  });
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
