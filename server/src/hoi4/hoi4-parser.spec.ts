import { analyzeSave } from './hoi4-parser';
import * as fs from 'fs';

// We'll create small synthetic save fragments to test war_relation parsing.

describe('hoi4-parser war_relation casualties (diagnostic)', () => {
  const tmpFile = 'test_synthetic.hoi4';

  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch (e) {}
  });

  function writeSave(content: string) {
    fs.writeFileSync(tmpFile, content, 'latin1');
  }

  test('single war_relation GER/SOV extracts both casualties', () => {
    const c = `dummy=1\nwar_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=12345 second_casualties=54321 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);
    // diagnostic field should exist
    // @ts-ignore
    expect(res.warCasualties).toBeDefined();
    // @ts-ignore
    const w = (res.warCasualties as any[]).find(
      (x) => x.firstTag === 'GER' && x.secondTag === 'SOV',
    );
    expect(w).toBeDefined();
    expect(w.firstCasualties).toBe(12345);
    expect(w.secondCasualties).toBe(54321);
  });

  test('two different wars for same country are both kept', () => {
    const c =
      `war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=111 second_casualties=222 }\n` +
      `war_relation={ first="GER" second="ENG" start_date="1940.5.1.1" first_casualties=333 second_casualties=444 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);
    // @ts-ignore
    const arr = res.warCasualties as any[];
    expect(
      arr.filter((x) => x.firstTag === 'GER' && x.secondTag === 'SOV').length,
    ).toBe(1);
    expect(
      arr.filter((x) => x.firstTag === 'GER' && x.secondTag === 'ENG').length,
    ).toBe(1);
  });

  test('mirror duplicate recorded as separate entries', () => {
    const c =
      `parentA={ war_relation={ first=\"GER\" second=\"SOV\" start_date=\"1941.6.12.2\" first_casualties=10 second_casualties=20 } }\n` +
      `parentB={ war_relation={ first=\"GER\" second=\"SOV\" start_date=\"1941.6.12.2\" first_casualties=10 second_casualties=20 } }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);
    // @ts-ignore
    const arr = res.warCasualties as any[];
    const matches = arr.filter(
      (x) => x.firstTag === 'GER' && x.secondTag === 'SOV',
    );
    expect(matches.length).toBe(2); // both recorded separately
  });

  test('incomplete block does not crash and is skipped or partial', () => {
    const c = `war_relation={ first=\"GER\" start_date=\"1941.6.12.2\" first_casualties=999 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);
    // @ts-ignore
    const arr = res.warCasualties as any[];
    expect(arr.length).toBeGreaterThanOrEqual(0);
    // if entry exists, ensure no crash accessing fields
    if (arr.length > 0) {
      const p = arr[0];
      expect(p.firstTag === 'GER' || p.firstTag === undefined).toBeTruthy();
    }
  });
  test('does not treat cached_sum as parentTag', () => {
    const c = `dummy={ cached_sum=-100 }
war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=111 second_casualties=222 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);
    // @ts-ignore
    const w = (res.warCasualties as any[])[0];
    expect(w.parentTag).toBeNull();
    expect(typeof w.sourceOffset).toBe('number');
  });

  test('maps a GER/SOV war relation to both countries with the right opponent and casualties', () => {
    const c = `war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=12345 second_casualties=54321 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);

    const ger = res.by_country.find((country) => country.tag === 'GER');
    const sov = res.by_country.find((country) => country.tag === 'SOV');

    expect(ger?.warCasualties).toEqual([
      {
        opponentTag: 'SOV',
        startDate: '1941.6.12.2',
        role: 'first',
        casualties: 12345,
      },
    ]);
    expect(sov?.warCasualties).toEqual([
      {
        opponentTag: 'GER',
        startDate: '1941.6.12.2',
        role: 'second',
        casualties: 54321,
      },
    ]);
  });

  test('includes countries that appear only through war casualty entries', () => {
    const c = `war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=123 second_casualties=456 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);

    const sov = res.by_country.find((country) => country.tag === 'SOV');
    expect(sov).toBeDefined();
    expect(sov?.warCasualties).toEqual([
      {
        opponentTag: 'GER',
        startDate: '1941.6.12.2',
        role: 'second',
        casualties: 456,
      },
    ]);
    expect(sov?.calculatedWarCasualtiesTotal).toBe(456);
  });

  test('keeps two wars for the same country as separate entries', () => {
    const c =
      `war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=100 second_casualties=200 }\n` +
      `war_relation={ first="GER" second="ENG" start_date="1940.5.1.1" first_casualties=300 second_casualties=400 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);

    const ger = res.by_country.find((country) => country.tag === 'GER');
    expect(ger?.warCasualties).toHaveLength(2);
    expect(ger?.warCasualties.map((entry) => entry.opponentTag)).toEqual([
      'SOV',
      'ENG',
    ]);
  });

  test('does not merge different startDate values', () => {
    const c =
      `war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=10 second_casualties=20 }\n` +
      `war_relation={ first="GER" second="SOV" start_date="1942.6.12.2" first_casualties=30 second_casualties=40 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);

    const ger = res.by_country.find((country) => country.tag === 'GER');
    expect(ger?.warCasualties).toHaveLength(2);
    expect(ger?.warCasualties.map((entry) => entry.startDate)).toEqual([
      '1941.6.12.2',
      '1942.6.12.2',
    ]);
  });

  test('preserves zero casualty entries', () => {
    const c = `war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=0 second_casualties=0 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);

    const ger = res.by_country.find((country) => country.tag === 'GER');
    expect(ger?.warCasualties).toEqual([
      {
        opponentTag: 'SOV',
        startDate: '1941.6.12.2',
        role: 'first',
        casualties: 0,
      },
    ]);
  });

  test('keeps raw AnalyzeResult.warCasualties unchanged while mapping per-country data', () => {
    const c = `war_relation={ first="GER" second="SOV" start_date="1941.6.12.2" first_casualties=12 second_casualties=34 }`;
    writeSave(c);
    const res = analyzeSave(tmpFile);

    expect(res.warCasualties).toHaveLength(1);
    expect(res.warCasualties?.[0]).toEqual(
      expect.objectContaining({
        firstTag: 'GER',
        secondTag: 'SOV',
        startDate: '1941.6.12.2',
        firstCasualties: 12,
        secondCasualties: 34,
      }),
    );
    expect(res.warCasualties?.[0]).not.toHaveProperty('opponentTag');
  });
});
