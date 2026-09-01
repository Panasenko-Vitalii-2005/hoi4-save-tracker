import {
  normalizeSaveComparisonContext,
  parseSaveComparisonContext,
} from './save-comparison-context';

describe('Save comparison context', () => {
  test('reads direct campaign UUID and game version without nested lookalikes', () => {
    const text = `HOI4txt
player_countries={
  player="USA"
  game_unique_id="11111111-1111-1111-1111-111111111111"
}
player="GER"
version="Operation Postern v1.19.2.0.a729 (d245)"
game_unique_id="0731C3C7-035E-46B1-B07B-6C35B27E8DC2"
countries={}`;
    expect(parseSaveComparisonContext(text)).toEqual({
      campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      gameVersion: 'Operation Postern v1.19.2.0.a729 (d245)',
      playerCountryTag: 'GER',
    });
  });

  test('missing or malformed fields remain unknown', () => {
    expect(parseSaveComparisonContext('HOI4txt\ncountries={}')).toEqual({
      campaignId: null,
      gameVersion: null,
      playerCountryTag: null,
    });
    expect(
      parseSaveComparisonContext(
        'HOI4txt\ngame_unique_id="not-a-uuid"\nversion=""',
      ),
    ).toEqual({
      campaignId: null,
      gameVersion: null,
      playerCountryTag: null,
    });
  });

  test('validates persisted context strictly while preserving explicit unknowns', () => {
    expect(
      normalizeSaveComparisonContext({
        campaignId: null,
        gameVersion: null,
      }),
    ).toEqual({ campaignId: null, gameVersion: null });
    expect(
      normalizeSaveComparisonContext({
        campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
        gameVersion: '1.19.2',
        playerCountryTag: 'GER',
      }),
    ).toEqual({
      campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      gameVersion: '1.19.2',
      playerCountryTag: 'GER',
    });
    expect(
      normalizeSaveComparisonContext({
        campaignId: null,
        gameVersion: null,
      }),
    ).toEqual({ campaignId: null, gameVersion: null });
    expect(normalizeSaveComparisonContext({ campaignId: 'bad' })).toBeNull();
    expect(
      normalizeSaveComparisonContext({ gameVersion: '\u0000' }),
    ).toBeNull();
    expect(
      normalizeSaveComparisonContext({ playerCountryTag: 'Germany' }),
    ).toBeNull();
  });
});
