import { match } from 'path-to-regexp';

describe('Static routing API exclusion', () => {
  const matchesApi = match('/api{/*path}');

  it.each([
    ['/api', true],
    ['/api/', true],
    ['/api/readiness', true],
    ['/api/nonexistent-test-route', true],
    ['/api/auth/me', true],
    ['/apix', false],
    ['/dashboard', false],
  ])('matches %s correctly', (url, expected) => {
    expect(Boolean(matchesApi(url))).toBe(expected);
  });
});
