import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  COMPLETE_SUNK_SHIP,
  sunkShipWith,
  topLevelHistory,
} from './naval-loss/fixtures/global-history.fixture';
import {
  assistedSunkShip,
  historyQueue,
  shipHistoryFixture,
} from './naval-loss/fixtures/ship-history.fixture';
import { analyzeSave } from './hoi4-parser';

describe('analyzeSave naval-loss integration', () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'hoi4-naval-integration-'));
  let fixtureNumber = 0;

  afterAll(() => {
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  function analyzeText(content: string) {
    const filePath = join(tempDirectory, `fixture-${fixtureNumber++}.hoi4`);
    writeFileSync(filePath, content, 'latin1');
    return analyzeSave(filePath);
  }

  test('includes navalLosses in AnalyzeResult', () => {
    expect(analyzeText('dummy=1')).toHaveProperty('navalLosses');
  });

  test('returns an empty naval-loss list when no records exist', () => {
    expect(analyzeText('dummy=1').navalLosses).toEqual([]);
  });

  test('exposes one normalized global loss with useful fields', () => {
    const result = analyzeText(topLevelHistory(COMPLETE_SUNK_SHIP));

    expect(result.navalLosses).toHaveLength(1);
    expect(result.navalLosses[0]).toMatchObject({
      rawRecordCount: 1,
      sunkShip: {
        name: 'U-144',
        countryTag: 'GER',
        definition: 'submarine',
      },
      event: {
        date: '1943.9.28.21',
        battle: { id: 124995, type: 4713, status: 'valid' },
      },
      attributions: [
        expect.objectContaining({
          killerCountryTag: 'ENG',
          killerName: 'HMS Napier',
        }),
      ],
      sourceSummary: {
        hasGlobalHistoryRecord: true,
        hasShipHistoryRecord: false,
        globalHistoryRecords: 1,
        shipHistoryRecords: 0,
      },
    });
  });

  test('exposes one normalized ship-history loss', () => {
    const result = analyzeText(shipHistoryFixture({ unitsWrapper: true }));

    expect(result.navalLosses).toHaveLength(1);
    expect(result.navalLosses[0].sourceSummary).toEqual({
      hasGlobalHistoryRecord: false,
      hasShipHistoryRecord: true,
      globalHistoryRecords: 0,
      shipHistoryRecords: 1,
    });
  });

  test('deduplicates equivalent global and ship-history copies', () => {
    const result = analyzeText(
      `${shipHistoryFixture({ unitsWrapper: true })}\n${topLevelHistory(COMPLETE_SUNK_SHIP)}`,
    );

    expect(result.navalLosses).toHaveLength(1);
    expect(result.navalLosses[0]).toMatchObject({
      rawRecordCount: 2,
      deduplicationStatus: 'matched_to_global',
      sourceSummary: {
        globalHistoryRecords: 1,
        shipHistoryRecords: 1,
      },
    });
  });

  test('keeps multiple named ships from one battle as separate events', () => {
    const first = sunkShipWith({ name: '"Destroyer One"' });
    const second = sunkShipWith({ name: '"Destroyer Two"' });
    const result = analyzeText(topLevelHistory(first, second));

    expect(result.navalLosses).toHaveLength(2);
    expect(result.navalLosses.map(({ sunkShip }) => sunkShip.name)).toEqual([
      'Destroyer One',
      'Destroyer Two',
    ]);
  });

  test('attaches assistant copies without increasing the event count', () => {
    const assisted = assistedSunkShip();
    const shipHistories = shipHistoryFixture({
      unitsWrapper: true,
      ships: [
        {
          id: '{ id=31 type=51 }',
          name: 'Assistant One',
          entries: [historyQueue(assisted)],
        },
        {
          id: '{ id=32 type=51 }',
          name: 'Assistant Two',
          entries: [historyQueue(assisted)],
        },
      ],
    });
    const result = analyzeText(
      `${shipHistories}\n${topLevelHistory(COMPLETE_SUNK_SHIP)}`,
    );

    expect(result.navalLosses).toHaveLength(1);
    expect(result.navalLosses[0].rawRecordCount).toBe(3);
    expect(
      result.navalLosses[0].attributions.filter(
        ({ role }) => role === 'assistant',
      ),
    ).toHaveLength(2);
  });

  test('keeps existing raw and per-country War Casualties output unchanged', () => {
    const war =
      'war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=123 second_casualties=456 }';
    const result = analyzeText(
      `${war}\n${topLevelHistory(COMPLETE_SUNK_SHIP)}`,
    );

    expect(result.warCasualties).toHaveLength(1);
    expect(result.warCasualties?.[0]).toMatchObject({
      firstTag: 'GER',
      secondTag: 'SOV',
      startDate: '1941.6.12.2',
      firstCasualties: 123,
      secondCasualties: 456,
      wargoalIds: [],
    });
    expect(
      result.by_country.find(({ tag }) => tag === 'GER')?.warCasualties,
    ).toEqual([
      {
        opponentTag: 'SOV',
        startDate: '1941.6.12.2',
        role: 'first',
        casualties: 123,
      },
    ]);
  });

  test('does not add naval fields to CountryStats', () => {
    const result = analyzeText(
      'war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=123 second_casualties=456 }',
    );
    const germany = result.by_country.find(({ tag }) => tag === 'GER');

    expect(germany).toEqual({
      tag: 'GER',
      divisions: 0,
      manpowerInField: 0,
      manpowerCasualties: null,
      warCasualties: [
        {
          opponentTag: 'SOV',
          startDate: '1941.6.12.2',
          role: 'first',
          casualties: 123,
        },
      ],
      calculatedWarCasualtiesTotal: 123,
      aircraft: 0,
      ships: 0,
      militaryFactories: 0,
      civilianFactories: 0,
      dockyards: 0,
    });
  });

  test('preserves analyzeSave metadata and existing totals', () => {
    const result = analyzeText(`date="1944.5.6.7"
states={
\t1={
\t\tbuildings={ arms_factory={ level=2 } industrial_complex={ level=3 } dockyard={ level=1 } }
\t\towner="GER"
\t}
}`);

    expect(result.game_date).toBe('1944.5.6');
    expect(result.active_countries).toBe(1);
    expect(result.totals).toMatchObject({
      militaryFactories: 2,
      civilianFactories: 3,
      dockyards: 1,
    });
    expect(result.parse_seconds).toBeGreaterThanOrEqual(0);
  });

  test('does not crash the complete analyzer on a malformed naval record', () => {
    const result = analyzeText(
      'history={ sunk_ship={ name="Broken" country="GER"',
    );

    expect(result.navalLosses).toHaveLength(1);
    expect(result.navalLosses[0]).toMatchObject({
      confidence: 'low',
      deduplicationStatus: 'ambiguous',
      countable: false,
    });
    expect(result.navalLosses[0].ambiguityReasons.length).toBeGreaterThan(0);
  });

  test('does not expose deduplication implementation keys', () => {
    const [event] = analyzeText(
      topLevelHistory(COMPLETE_SUNK_SHIP),
    ).navalLosses;
    const serialized = JSON.stringify(event);

    expect(event).not.toHaveProperty('matchKey');
    expect(event).not.toHaveProperty('candidate');
    expect(event).not.toHaveProperty('signature');
    expect(event).not.toHaveProperty('bucket');
    expect(serialized).not.toContain('matchKey');
    expect(serialized).not.toContain('candidateKey');
  });
});
