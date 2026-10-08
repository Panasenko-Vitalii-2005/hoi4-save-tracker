import { PrivacyController, publicSupportEmail } from './privacy.controller';

describe('public support contact configuration', () => {
  test.each([
    undefined,
    '',
    'not-an-email',
    'a@example.invalid?subject=secret',
    'a@example.invalid\r\nBcc:other@example.invalid',
    'Name <a@example.invalid>',
    'a..b@example.invalid',
    '.a@example.invalid',
    'a@example',
    'a@-bad.invalid',
  ])('invalid or absent mailbox fails visibly closed: %s', (value) => {
    expect(publicSupportEmail({ HOI4_SUPPORT_EMAIL: value })).toBeNull();
  });
  test('exposes only the configured public address, not other server configuration', () => {
    const before = process.env.HOI4_SUPPORT_EMAIL;
    try {
      process.env.HOI4_SUPPORT_EMAIL = ' alpha-support@example.invalid ';
      expect(new PrivacyController().contact()).toEqual({
        supportEmail: 'alpha-support@example.invalid',
      });
      expect(
        publicSupportEmail({
          HOI4_SUPPORT_EMAIL: 'a+support@example.invalid',
          SECRET: 'hidden',
        }),
      ).toBe('a+support@example.invalid');
    } finally {
      if (before === undefined) delete process.env.HOI4_SUPPORT_EMAIL;
      else process.env.HOI4_SUPPORT_EMAIL = before;
    }
  });
});
