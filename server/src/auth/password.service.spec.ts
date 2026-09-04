import { DUMMY_PASSWORD_HASH, PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  test('creates salted versioned scrypt hashes and verifies the password', async () => {
    const plaintext = 'correct horse battery staple';
    const first = await passwords.hash(plaintext);
    const second = await passwords.hash(plaintext);

    expect(first).toMatch(/^\$scrypt\$v=1\$N=32768,r=8,p=1\$/);
    expect(first).not.toBe(plaintext);
    expect(second).not.toBe(first);
    await expect(passwords.verify(plaintext, first)).resolves.toBe(true);
    await expect(passwords.verify('incorrect password', first)).resolves.toBe(
      false,
    );
  });

  test.each(['', 'plaintext', '$scrypt$v=1$N=32768,r=8,p=1$bad$bad'])(
    'rejects malformed encoded hash %# safely',
    async (encoded) => {
      await expect(
        passwords.verify('never logged secret', encoded),
      ).resolves.toBe(false);
    },
  );

  test('dummy hash is valid for the fixed timing-mitigation password', async () => {
    await expect(
      passwords.verify('hoi4-dummy-password', DUMMY_PASSWORD_HASH),
    ).resolves.toBe(true);
  });
});
