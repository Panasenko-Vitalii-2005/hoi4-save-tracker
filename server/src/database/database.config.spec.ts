import { databaseConfig, databaseEnabled } from './database.config';

describe('database configuration', () => {
  test.each([
    [{}, false],
    [{ HOI4_DATABASE_ENABLED: '' }, false],
    [{ HOI4_DATABASE_ENABLED: 'false' }, false],
    [{ HOI4_DATABASE_ENABLED: '1' }, false],
    [{ HOI4_DATABASE_ENABLED: 'true' }, true],
    [{ HOI4_DATABASE_ENABLED: ' TRUE ' }, true],
  ] satisfies Array<[NodeJS.ProcessEnv, boolean]>)(
    'parses database enablement safely',
    (environment, enabled) => {
      expect(databaseEnabled(environment)).toBe(enabled);
    },
  );

  test('returns an inert disabled configuration without DATABASE_URL', () => {
    expect(databaseConfig({})).toEqual({
      enabled: false,
      connectionString: null,
    });
  });

  test.each([
    {},
    { DATABASE_URL: 'postgresql:///example' },
    { DATABASE_URL: 'not a url' },
    { DATABASE_URL: 'https://db.example.com/database' },
    { DATABASE_URL: 'postgresql://db' },
  ])('rejects missing or invalid enabled configuration', (extra) => {
    expect(() =>
      databaseConfig({ HOI4_DATABASE_ENABLED: 'true', ...extra }),
    ).toThrow(/DATABASE_URL/);
  });

  test('preserves a valid PostgreSQL connection string without logging it', () => {
    const connectionString =
      'postgresql://app:secret@db.internal:5432/hoi4_tracker?sslmode=require';
    expect(
      databaseConfig({
        HOI4_DATABASE_ENABLED: 'true',
        DATABASE_URL: connectionString,
      }),
    ).toEqual({ enabled: true, connectionString });
  });
});
