import { join } from 'path';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import {
  buildCountryNameMap,
  CountryResolver,
  generateCountriesJson,
} from './country-resolver';

describe('CountryResolver module', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hoi4-country-resolver-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('parses valid country lines and ignores TAG_ADJ / TAG_DEF', async () => {
    const fileContent = `\uFEFF GER:0 "Germany"
SOV:0 "Soviet Union"
ENG:0 "United Kingdom"
GER_ADJ:0 "German"
SOV_DEF:0 "the Soviet Union"
`;
    await writeFile(
      join(tempDir, 'countries_l_english.yml'),
      fileContent,
      'utf8',
    );

    const map = await buildCountryNameMap(tempDir);

    expect(map).toEqual({
      GER: 'Germany',
      SOV: 'Soviet Union',
      ENG: 'United Kingdom',
    });
  });

  it('writes a JSON map file and can reload it with CountryResolver', async () => {
    const fileContent = `FRA:0 "France"\nUSA:0 "United States"\n`;
    await writeFile(
      join(tempDir, 'countries_l_english.yml'),
      fileContent,
      'utf8',
    );

    const outputJson = join(tempDir, 'countries.json');
    await generateCountriesJson(tempDir, outputJson);

    const fileText = await readFile(outputJson, 'utf8');
    expect(JSON.parse(fileText)).toEqual({
      FRA: 'France',
      USA: 'United States',
    });

    const resolver = await CountryResolver.fromJsonFile(outputJson);
    expect(resolver.getName('fra')).toBe('France');
    expect(resolver.getName('USA')).toBe('United States');
    expect(resolver.getName('XYZ')).toBe('XYZ');
  });
});
