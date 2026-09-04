import { AuthValidationError } from './auth.errors';

export const SESSION_TTL_SECONDS = Symbol('SESSION_TTL_SECONDS');
export const SESSION_COOKIE_SECURE = Symbol('SESSION_COOKIE_SECURE');
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MIN_SESSION_TTL_SECONDS = 5 * 60;
export const MAX_SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

export function sessionTtlSeconds(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const configured = environment.HOI4_SESSION_TTL_SECONDS?.trim();
  if (!configured) return DEFAULT_SESSION_TTL_SECONDS;
  if (!/^\d+$/.test(configured)) {
    throw new Error('HOI4_SESSION_TTL_SECONDS must be a valid integer');
  }
  const value = Number(configured);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_SESSION_TTL_SECONDS ||
    value > MAX_SESSION_TTL_SECONDS
  ) {
    throw new Error(
      `HOI4_SESSION_TTL_SECONDS must be between ${MIN_SESSION_TTL_SECONDS} and ${MAX_SESSION_TTL_SECONDS}`,
    );
  }
  return value;
}

export function sessionCookieSecure(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = environment.HOI4_SESSION_COOKIE_SECURE?.trim();
  if (configured === undefined || configured === '') {
    return environment.NODE_ENV === 'production';
  }
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  throw new Error('HOI4_SESSION_COOKIE_SECURE must be true or false');
}

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export function validatePassword(password: unknown): string {
  if (
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    password.trim().length === 0
  ) {
    throw new AuthValidationError(
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
  return password;
}

export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') {
    throw new AuthValidationError('A valid email address is required');
  }
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+$/.test(normalized)
  ) {
    throw new AuthValidationError('A valid email address is required');
  }
  return normalized;
}
