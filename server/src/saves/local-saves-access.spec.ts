import { localSavesEnabled } from './local-saves-access';

describe('local save access configuration', () => {
  test.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['1', false],
    ['yes', false],
    ['true', true],
    [' TRUE ', true],
  ])('parses %p as %p', (value, expected) => {
    expect(
      localSavesEnabled(
        value === undefined ? {} : { HOI4_LOCAL_SAVES_ENABLED: value },
      ),
    ).toBe(expected);
  });
});
