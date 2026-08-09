import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { analyzeSave } from './hoi4-parser';
import { decodeSaveText } from './save-text.decoder';

const MOWE = 'M\u00f6we';
const POTOSI = 'Potos\u00ed';
const MARCILIO = 'Marc\u00edlio';
const CYRILLIC = '\u041a\u0438\u0457\u0432';

function navalSave(shipName: string): string {
  return `HOI4txt
history={
  sunk_ship={
    name="${shipName}"
    killer_name="HMS Example"
    country="GER"
    killer_country="ENG"
    definition="destroyer"
    killer_definition="destroyer"
    level=1
    equipment_variant={ id=1 type=70 }
    date="1941.1.1.1"
    location=1
    battle={ id=1 type=4713 }
    convoy=no
  }
}`;
}

describe('decodeSaveText', () => {
  test('preserves ASCII text', () => {
    expect(decodeSaveText(Buffer.from('HOI4txt\nplayer="GER"', 'utf8'))).toBe(
      'HOI4txt\nplayer="GER"',
    );
  });

  test.each([
    ['Mowe', MOWE],
    ['Potosi', POTOSI],
    ['Marcilio', MARCILIO],
    ['Cyrillic', CYRILLIC],
  ])('decodes UTF-8 %s text exactly', (_label, value) => {
    expect(decodeSaveText(Buffer.from(value, 'utf8'))).toBe(value);
  });

  test('preserves mixed ASCII and non-ASCII text', () => {
    const text = `name="${MOWE}" country="GER" city="${CYRILLIC}"`;

    expect(decodeSaveText(Buffer.from(text, 'utf8'))).toBe(text);
  });

  test('preserves save syntax and newlines', () => {
    const text = `history={\n\tsunk_ship={ name="${POTOSI}" }\n}\n`;

    expect(decodeSaveText(Buffer.from(text, 'utf8'))).toBe(text);
  });

  test('does not double-decode already correct Unicode text', () => {
    const text = `${MOWE} / ${POTOSI} / ${MARCILIO}`;
    const decoded = decodeSaveText(Buffer.from(text, 'utf8'));

    expect(decoded).toBe(text);
    expect(decoded).not.toContain('\u00c3');
  });
});

describe('analyzeSave UTF-8 integration', () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'hoi4-encoding-'));

  afterAll(() => {
    rmSync(tempDirectory, { recursive: true, force: true });
  });

  test('preserves a Unicode ship name from a plain-text save', () => {
    const filePath = join(tempDirectory, 'plain.hoi4');
    writeFileSync(filePath, Buffer.from(navalSave(MOWE), 'utf8'));

    const result = analyzeSave(filePath);

    expect(result.navalLosses[0].sunkShip.name).toBe(MOWE);
    expect(result.navalKills[0].sunkShip.name).toBe(MOWE);
  });

  test('preserves a Unicode ship name from a ZIP-compressed save', () => {
    const filePath = join(tempDirectory, 'compressed.hoi4');
    const zip = new AdmZip();
    zip.addFile('gamestate', Buffer.from(navalSave(POTOSI), 'utf8'));
    writeFileSync(filePath, zip.toBuffer());

    const result = analyzeSave(filePath);

    expect(result.navalLosses[0].sunkShip.name).toBe(POTOSI);
    expect(result.navalKills[0].sunkShip.name).toBe(POTOSI);
  });
});
