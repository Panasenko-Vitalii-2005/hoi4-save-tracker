import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';

export function allowedFrontendOrigin(
  configured = process.env.HOI4_CORS_ORIGIN,
): string {
  const value = configured?.trim();
  if (!value) return DEFAULT_FRONTEND_ORIGIN;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('HOI4_CORS_ORIGIN must be a valid HTTP(S) origin');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('HOI4_CORS_ORIGIN must be a valid HTTP(S) origin');
  }
  return url.origin;
}

export function configureHttpSecurity(app: INestApplication): void {
  app.enableCors({ origin: allowedFrontendOrigin() });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
}
