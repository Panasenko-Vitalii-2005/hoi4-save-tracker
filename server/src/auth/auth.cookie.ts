import type { Request, Response } from 'express';
import type { AuthService } from './auth.service';

export const SESSION_COOKIE_NAME = 'hoi4_session';

export function readSessionCookie(header: string | undefined): string | null {
  return readCookie(header, SESSION_COOKIE_NAME);
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return values.length === 1 && values[0] ? values[0] : null;
}

export async function revokeSessionCookie(
  auth: AuthService,
  request: Request,
  response: Response,
  secure: boolean,
): Promise<void> {
  try {
    const token = readSessionCookie(request.headers.cookie);
    if (token) await auth.logout(token);
  } finally {
    clearSessionCookie(response, secure);
  }
}

export function setSessionCookie(
  response: Response,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: expiresAt,
    maxAge,
  });
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
}
