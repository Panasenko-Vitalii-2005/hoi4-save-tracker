import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const PREFIX = '$scrypt$v=1$N=32768,r=8,p=1$';

export const DUMMY_PASSWORD_HASH =
  '$scrypt$v=1$N=32768,r=8,p=1$AAECAwQFBgcICQoLDA0ODw$wLHxf3fbZH44saf5S1TMuviotUmqE-wltu4w1LImmReynKuAKLiVIAQvKFW0_P5HbAcUNvbMARbCONEa9uYYew';

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt);
    return `${PREFIX}${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    if (!encoded.startsWith(PREFIX)) return false;
    const parts = encoded.slice(PREFIX.length).split('$');
    if (parts.length !== 2) return false;
    try {
      const salt = Buffer.from(parts[0], 'base64url');
      const expected = Buffer.from(parts[1], 'base64url');
      if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) {
        return false;
      }
      const actual = await derive(password, salt);
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  verifyDummy(password: string): Promise<boolean> {
    return this.verify(password, DUMMY_PASSWORD_HASH);
  }
}
