import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { allowedFrontendOrigin } from '../http-security';
import { SESSION_COOKIE_SECURE } from './auth.config';
import { readCookie } from './auth.cookie';

export const CSRF_COOKIE_NAME = 'hoi4_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class CsrfService {
  private readonly allowedOrigin = allowedFrontendOrigin();

  constructor(
    @Inject(SESSION_COOKIE_SECURE) private readonly secureCookie: boolean,
  ) {}

  bootstrap(request: Request, response: Response): string {
    const existing = readCookie(request.headers.cookie, CSRF_COOKIE_NAME);
    // Reuse a valid token so another tab/bootstrap cannot invalidate in-flight work.
    const token =
      existing && TOKEN_PATTERN.test(existing)
        ? existing
        : randomBytes(32).toString('base64url');
    response.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: this.secureCookie,
      path: '/',
    });
    response.setHeader('Cache-Control', 'no-store');
    return token;
  }

  validate(request: Request): void {
    const cookie = readCookie(request.headers.cookie, CSRF_COOKIE_NAME);
    const header = request.headers[CSRF_HEADER_NAME];
    const origin = request.headers.origin;
    const sameOrigin = `${request.protocol}://${request.get('host')}`;
    if (
      (origin !== undefined &&
        origin !== this.allowedOrigin &&
        origin !== sameOrigin) ||
      !cookie ||
      !TOKEN_PATTERN.test(cookie) ||
      typeof header !== 'string' ||
      !TOKEN_PATTERN.test(header) ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
    ) {
      throw new ForbiddenException({
        code: 'CSRF_INVALID',
        message: 'Request verification failed. Refresh the page and try again.',
      });
    }
  }
}
