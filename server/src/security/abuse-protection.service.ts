import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, Response, NextFunction } from 'express';
import { securityFlag } from './alpha-security.config';

type Limit = { name: string; count: number; seconds: number };
type Policy = { ip: Limit; global: Limit; identity?: Limit };
const limit = (name: string, count: number, seconds: number): Limit => ({
  name,
  count,
  seconds,
});

// Limits count attempts, including invalid requests. Separate identities share
// a generous NAT ceiling, not a single small per-user allowance.
export const ABUSE_POLICIES = {
  register: {
    ip: limit('register-ip', 40, 3600),
    global: limit('register-global', 100, 3600),
    identity: limit('register-account', 5, 3600),
  },
  login: {
    ip: limit('login-ip', 120, 900),
    global: limit('login-global', 600, 900),
    identity: limit('login-account', 10, 900),
  },
  share: {
    ip: limit('share-ip', 60, 60),
    global: limit('share-global', 300, 60),
  },
  telemetry: {
    ip: limit('telemetry-ip', 600, 60),
    global: limit('telemetry-global', 2000, 60),
    identity: limit('telemetry-user', 120, 60),
  },
  upload: {
    ip: limit('upload-ip', 600, 3600),
    global: limit('upload-global', 1000, 3600),
    identity: limit('upload-user', 120, 3600),
  },
  preflight: {
    ip: limit('preflight-ip', 120, 60),
    global: limit('preflight-global', 600, 60),
    identity: limit('preflight-user', 30, 60),
  },
  session: {
    ip: limit('session-ip', 600, 60),
    global: limit('session-global', 5000, 60),
  },
} satisfies Record<string, Policy>;
export type AbuseRoute = keyof typeof ABUSE_POLICIES;
export const MAX_ABUSE_BUCKETS = 10_000;

export function abuseRoute(
  request: Pick<Request, 'method' | 'path'>,
): AbuseRoute | null {
  // Express routes are case-insensitive and accept a trailing slash.
  const path = request.path.toLowerCase().replace(/\/+$/, '');
  if (request.method === 'POST') {
    if (path === '/api/auth/register') return 'register';
    if (path === '/api/auth/login') return 'login';
    if (path === '/api/analyze') return 'upload';
    if (path === '/api/analyze/batch/preflight') return 'preflight';
    if (path === '/api/product-events/client') return 'telemetry';
    if (path === '/api/auth/logout') return 'session';
  }
  if (['GET', 'HEAD'].includes(request.method)) {
    if (path.startsWith('/api/share/')) return 'share';
    if (['/api/auth/csrf', '/api/auth/me'].includes(path)) return 'session';
  }
  return null;
}

function clientIdentity(request: Request): string {
  // Express resolves req.ip from the socket and explicitly trusted proxy chain.
  // Never read X-Forwarded-For directly. Invalid identity fails into one bucket.
  const ip = request.ip;
  if (!ip || !isIP(ip)) return 'unknown-client';
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) !== 6) return ip;
  try {
    return new URL(`http://[${ip}]`).hostname;
  } catch {
    return 'unknown-client';
  }
}

export function rateLimitBody(retryAfterSeconds: number) {
  return {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Retry after the indicated delay.',
    retryAfterSeconds,
  };
}

@Injectable()
export class AbuseProtectionService implements OnModuleDestroy {
  readonly enabled = securityFlag('HOI4_ABUSE_PROTECTION_ENABLED');
  private readonly secret = randomBytes(32);
  private readonly buckets = new Map<
    string,
    { count: number; expires: number }
  >();
  private readonly cleanup = setInterval(() => this.prune(), 30_000).unref();

  onModuleDestroy(): void {
    clearInterval(this.cleanup);
    this.buckets.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.expires <= now) this.buckets.delete(key);
    }
  }

  private key(rule: Limit, identity: string): string {
    return createHmac('sha256', this.secret)
      .update(`${rule.name}\0${identity}`)
      .digest('hex');
  }

  private consume(rules: [Limit, string][]): number | null {
    if (!this.enabled) return null;
    const now = Date.now();
    const keys = rules.map(([rule, identity]) => ({
      rule,
      key: this.key(rule, identity),
    }));
    let retry = 0;
    for (const { rule, key } of keys) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.expires > now && bucket.count >= rule.count) {
        retry = Math.max(retry, Math.ceil((bucket.expires - now) / 1000));
      }
    }
    if (retry) return retry;
    if (
      this.buckets.size +
        keys.filter(({ key }) => !this.buckets.has(key)).length >
      MAX_ABUSE_BUCKETS
    ) {
      this.prune();
      if (
        this.buckets.size +
          keys.filter(({ key }) => !this.buckets.has(key)).length >
        MAX_ABUSE_BUCKETS
      ) {
        // Never evict live limits to make identity rotation a bypass.
        return 30;
      }
    }
    for (const { rule, key } of keys) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.expires > now) bucket.count++;
      else
        this.buckets.set(key, { count: 1, expires: now + rule.seconds * 1000 });
    }
    return null;
  }

  identityLimit(route: AbuseRoute, identity: string): number | null {
    const policy: Policy = ABUSE_POLICIES[route];
    return policy.identity ? this.consume([[policy.identity, identity]]) : null;
  }

  readonly middleware = (
    request: Request,
    response: Response,
    next: NextFunction,
  ): void => {
    const route = abuseRoute(request);
    if (!route || !this.enabled) return next();
    const policy = ABUSE_POLICIES[route];
    const retry = this.consume([
      [policy.ip, clientIdentity(request)],
      [policy.global, 'process'],
    ]);
    if (retry === null) return next();
    response.setHeader('Retry-After', retry);
    response.setHeader('Cache-Control', 'no-store');
    response.status(429).json(rateLimitBody(retry));
  };
}
