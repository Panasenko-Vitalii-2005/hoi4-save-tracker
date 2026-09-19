import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import {
  readSaveText,
  validateSaveFile,
  validateSaveFileFormat,
  validateSaveStructure,
} from './save-container';
import { saveUploadPolicy, MAX_ZIP_ENTRIES } from './save-upload.policy';
import { findDirectBlocks } from './naval-loss/global-history.parser';
import {
  smallSave,
  binarySave,
  zipSave,
  forgedZipSize,
  zipOffsets,
} from '../analyze/fixtures/upload.fixture';

describe('Bounded HoI4 save containers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hoi4-container-test-'));
  const file = join(directory, 'save.hoi4');
  const prior = process.env.HOI4_MAX_UNCOMPRESSED_BYTES;
  afterEach(() => {
    if (prior === undefined) delete process.env.HOI4_MAX_UNCOMPRESSED_BYTES;
    else process.env.HOI4_MAX_UNCOMPRESSED_BYTES = prior;
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  const put = (bytes: string | Buffer) => {
    writeFileSync(file, bytes);
    return file;
  };
  const policy = saveUploadPolicy({});

  test('reports only the validated plain/ZIP container format', async () => {
    put(smallSave());
    await expect(validateSaveFileFormat(file)).resolves.toBe('plain_text');
    put(zipSave(smallSave()));
    await expect(validateSaveFileFormat(file)).resolves.toBe('zip_text');
  });

  test.each(['plain', 'zip', 'named zip', 'stored zip', 'BOM'])(
    '%s text decodes exactly once with unchanged Unicode',
    async (kind) => {
      const text = smallSave('name="Möwe / ARM Potosí / NRB Marcílio Dias"');
      if (kind === 'plain') put(text);
      else if (kind === 'BOM') put('\uFEFF' + text);
      else {
        const zip = new AdmZip();
        zip.addFile(
          kind === 'named zip' ? 'autosave.hoi4' : 'gamestate',
          Buffer.from(text),
        );
        if (kind === 'stored zip') zip.getEntries()[0].header.method = 0;
        put(zip.toBuffer());
      }
      await expect(validateSaveFile(file)).resolves.toBeUndefined();
      expect(readSaveText(file, true)).toBe(
        kind === 'BOM' ? '\uFEFF' + text : text,
      );
    },
  );
  test.each([
    ['', 'EMPTY_FILE'],
    ['random text', 'INVALID_SAVE'],
    ['EU4txt\ndate="1444.11.11"', 'INVALID_SAVE'],
    [Buffer.from([255, 216, 255, 224, 1, 2, 3]), 'INVALID_SAVE'],
    ['PKinvalid', 'CORRUPT_ARCHIVE'],
    [binarySave(), 'UNSUPPORTED_BINARY_SAVE'],
  ])(
    'rejects unsupported/empty/corrupt prefix %# safely',
    async (input, code) => {
      put(input);
      await expect(validateSaveFile(file)).rejects.toMatchObject({ code });
    },
  );
  test('detects binary payloads in plain and supported ZIP containers', async () => {
    const expectBinaryError = () => {
      let failure: unknown;
      try {
        readSaveText(file, true);
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 'UNSUPPORTED_BINARY_SAVE' });
    };

    put(binarySave());
    await expect(validateSaveFile(file)).rejects.toMatchObject({
      code: 'UNSUPPORTED_BINARY_SAVE',
    });
    expectBinaryError();

    put(zipSave(binarySave()));
    await expect(validateSaveFile(file)).resolves.toBeUndefined();
    expectBinaryError();
  });
  test('raw upload and plain uncompressed limits are independent', async () => {
    put(smallSave());
    await expect(
      validateSaveFile(file, { ...policy, maxUploadBytes: 10 }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(
      validateSaveFile(file, { ...policy, maxUncompressedBytes: 10 }),
    ).rejects.toMatchObject({ code: 'DECOMPRESSED_SIZE_LIMIT' });
    process.env.HOI4_MAX_UNCOMPRESSED_BYTES = '10';
    expect(() => readSaveText(file, true)).toThrow('uncompressed');
  });
  test('declared expansion is rejected without inflating', async () => {
    put(zipSave(smallSave('padding="' + 'A'.repeat(5000) + '"')));
    await expect(
      validateSaveFile(file, { ...policy, maxUncompressedBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'DECOMPRESSED_SIZE_LIMIT' });
  });
  test.each([0, 1, 100])(
    'forged size %i cannot bypass the actual inflate bound',
    async (size) => {
      put(forgedZipSize(size, smallSave('padding="' + 'A'.repeat(5000) + '"')));
      process.env.HOI4_MAX_UNCOMPRESSED_BYTES = '1024';
      await expect(validateSaveFile(file)).resolves.toBeUndefined();
      expect(() => readSaveText(file, true)).toThrow('uncompressed');
    },
  );
  test('forged size within the cap is still corrupt rather than truncated accepted data', () => {
    put(forgedZipSize(5, smallSave()));
    expect(() => readSaveText(file, true)).toThrow('corrupted');
  });
  test('garbage payload inside a supported ZIP is rejected before parsing', () => {
    put(zipSave('JPEG or other game data'));
    expect(() => readSaveText(file, true)).toThrow('not a Hearts');
  });
  test.each(['readme.txt', '../gamestate', 'folder/gamestate'])(
    'unsupported entry %s is not extracted',
    async (name) => {
      put(zipSave(smallSave(), name));
      await expect(validateSaveFile(file)).rejects.toMatchObject({
        code: 'UNSUPPORTED_SAVE',
      });
    },
  );
  test.each([2, MAX_ZIP_ENTRIES + 1])(
    'rejects ambiguous/excess entry count %i before entry construction',
    async (count) => {
      const zip = new AdmZip();
      for (let i = 0; i < count; i++)
        zip.addFile(`${i}.hoi4`, Buffer.from(smallSave()));
      put(zip.toBuffer());
      await expect(validateSaveFile(file)).rejects.toMatchObject({
        code: 'UNSUPPORTED_SAVE',
      });
    },
  );
  test.each([
    'encrypted',
    'method',
    'symlink',
    'split',
    'zip64',
    'central-size',
    'local-name',
    'local-size',
    'truncated',
  ])('rejects malformed/unsupported ZIP %s', async (kind) => {
    let bytes = zipSave();
    const { central, end } = zipOffsets(bytes);
    if (kind === 'encrypted') bytes.writeUInt16LE(1, central + 8);
    if (kind === 'method') bytes.writeUInt16LE(99, central + 10);
    if (kind === 'symlink')
      bytes.writeUInt32LE((0xa1ff * 65536) >>> 0, central + 38);
    if (kind === 'split') bytes.writeUInt16LE(1, end + 4);
    if (kind === 'zip64') bytes.writeUInt32LE(0xffffffff, central + 24);
    if (kind === 'central-size') bytes.writeUInt32LE(0xfffffff0, end + 12);
    if (kind === 'local-name') bytes[30] = 120;
    if (kind === 'local-size') bytes.writeUInt32LE(99, 22);
    if (kind === 'truncated') bytes = bytes.subarray(0, bytes.length - 10);
    put(bytes);
    await expect(validateSaveFile(file)).rejects.toHaveProperty('code');
    expect(() => readSaveText(file, true)).toThrow();
  });
  test('checks CRC and actual compressed data, not only metadata', async () => {
    const bytes = zipSave();
    const { central, data } = zipOffsets(bytes);
    bytes.writeUInt32LE(123, central + 16);
    bytes.writeUInt32LE(123, 14);
    put(bytes);
    await expect(validateSaveFile(file)).resolves.toBeUndefined();
    expect(() => readSaveText(file, true)).toThrow('corrupted');
    bytes[data] = 255;
    put(bytes);
    expect(() => readSaveText(file, true)).toThrow('corrupted');
  });
  test.each(['countries={ GER={', 'countries={}\n}', 'name="unterminated'])(
    'incomplete envelope %s fails using the shared index',
    (extra) => {
      const text = smallSave(extra);
      expect(() =>
        validateSaveStructure(text, findDirectBlocks(text, 0, text.length)),
      ).toThrow();
    },
  );
  test('unknown modded fields and quoted braces remain valid', () => {
    const text = smallSave('mod_unknown={ field="{}" value=-1000.3 }');
    expect(() =>
      validateSaveStructure(text, findDirectBlocks(text, 0, text.length)),
    ).not.toThrow();
  });
});
