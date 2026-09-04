import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

@Injectable()
export class SessionTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  valid(token: unknown): token is string {
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
  }
}
