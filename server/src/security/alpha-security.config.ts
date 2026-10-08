import { isIP } from 'node:net';
import { normalizeEmail } from '../auth/auth.config';

export function securityFlag(name: string): boolean {
  const value = process.env[name]?.trim();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be true or false`);
}

export function registrationAdmission(): ReadonlySet<string> | null {
  if (!securityFlag('HOI4_REGISTRATION_INVITE_ONLY')) return null;
  const entries = (process.env.HOI4_REGISTRATION_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length > 200)
    throw new Error('Registration allowlist is too large');
  try {
    return new Set(entries.map(normalizeEmail));
  } catch {
    // Never include configured identities in startup errors.
    throw new Error('HOI4_REGISTRATION_ALLOWLIST contains an invalid email');
  }
}

export function trustedProxyCidrs(
  value = process.env.HOI4_TRUSTED_PROXY_CIDRS,
): string[] {
  if (!value?.trim()) return [];
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length > 32) throw new Error('Too many trusted proxy ranges');
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const family = isIP(address);
    const bits = family === 4 ? 32 : 128;
    if (
      !family ||
      extra !== undefined ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > bits))
    ) {
      throw new Error(
        'HOI4_TRUSTED_PROXY_CIDRS requires explicit IPs/CIDRs, not universal trust',
      );
    }
  }
  return entries;
}
