import {
  registrationAdmission,
  securityFlag,
  trustedProxyCidrs,
} from './alpha-security.config';

describe('alpha security configuration', () => {
  const previous = { ...process.env };
  afterEach(() => {
    process.env = { ...previous };
  });

  test('secure modes are opt-in and invalid values fail startup', () => {
    delete process.env.HOI4_ABUSE_PROTECTION_ENABLED;
    expect(securityFlag('HOI4_ABUSE_PROTECTION_ENABLED')).toBe(false);
    process.env.HOI4_ABUSE_PROTECTION_ENABLED = 'yes';
    expect(() => securityFlag('HOI4_ABUSE_PROTECTION_ENABLED')).toThrow();
  });
  test('empty allowlist denies all new registrations; invalid config does not echo identity', () => {
    process.env.HOI4_REGISTRATION_INVITE_ONLY = 'true';
    process.env.HOI4_REGISTRATION_ALLOWLIST = '';
    expect(registrationAdmission()?.size).toBe(0);
    process.env.HOI4_REGISTRATION_ALLOWLIST = 'private invalid identity';
    expect(() => registrationAdmission()).toThrow('contains an invalid email');
    try {
      registrationAdmission();
    } catch (error) {
      expect(String(error)).not.toContain('private invalid identity');
    }
  });
  test('proxy trust requires explicit bounded IP ranges, never hop-count or blanket trust', () => {
    expect(trustedProxyCidrs('')).toEqual([]);
    expect(trustedProxyCidrs('172.28.0.0/24,::1')).toEqual([
      '172.28.0.0/24',
      '::1',
    ]);
    for (const invalid of [
      'true',
      '1',
      'uniquelocal',
      '0.0.0.0/0',
      '::/0',
      '10.1.1.1/33',
      '::1/129',
      'bad,',
    ]) {
      expect(() => trustedProxyCidrs(invalid)).toThrow();
    }
  });
});
