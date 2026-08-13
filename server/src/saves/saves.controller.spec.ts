import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  getLocalSavesRoot,
  LocalSavePathError,
  resolveLocalSavePath,
} from './local-saves';
import { SavesController } from './saves.controller';

describe('local saves directory', () => {
  const originalRoot = process.env.HOI4_SAVES_DIR;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hoi4-local-saves-'));
    process.env.HOI4_SAVES_DIR = root;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (originalRoot === undefined) delete process.env.HOI4_SAVES_DIR;
    else process.env.HOI4_SAVES_DIR = originalRoot;
  });

  const expectPathError = (requestedPath: string, code: string) => {
    try {
      resolveLocalSavePath(requestedPath);
      throw new Error('Expected local save path validation to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LocalSavePathError);
      if (error instanceof LocalSavePathError) {
        expect(error.code).toBe(code);
      }
    }
  };

  test('uses the configured save root and lists only .hoi4 files', () => {
    writeFileSync(join(root, 'autosave.hoi4'), 'HOI4txt');
    writeFileSync(join(root, 'notes.txt'), 'ignored');

    const result = new SavesController().listSaves();

    expect(result).toMatchObject({ dir: resolve(root), exists: true });
    expect(result.files.map((file) => file.name)).toEqual(['autosave.hoi4']);
  });

  test('preserves Unicode filenames', () => {
    const name = 'M\u00f6we Potos\u00ed.hoi4';
    writeFileSync(join(root, name), 'HOI4txt');

    expect(new SavesController().listSaves().files[0].name).toBe(name);
  });

  test('handles a missing configured directory cleanly', () => {
    const missing = join(root, 'missing');
    process.env.HOI4_SAVES_DIR = missing;

    expect(new SavesController().listSaves()).toEqual({
      dir: resolve(missing),
      exists: false,
      files: [],
    });
  });

  test('rejects nested traversal outside the configured root', () => {
    expectPathError('../outside.hoi4', 'outside_root');
  });

  test('rejects an absolute path outside the configured root', () => {
    const outside = join(tmpdir(), 'outside.hoi4');

    expectPathError(outside, 'outside_root');
  });

  test('rejects non-HOI4 local files', () => {
    writeFileSync(join(root, 'notes.txt'), 'not a save');

    expectPathError('notes.txt', 'invalid_extension');
  });

  test('has a project-relative fallback when the environment is unset', () => {
    delete process.env.HOI4_SAVES_DIR;

    expect(getLocalSavesRoot()).toBe(resolve(process.cwd(), '..', 'saves'));
  });
});
