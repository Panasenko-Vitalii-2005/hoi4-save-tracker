import * as fs from 'fs';
import * as path from 'path';

export type LocalSavePathErrorCode =
  'root_unavailable' | 'outside_root' | 'invalid_extension' | 'file_not_found';

export class LocalSavePathError extends Error {
  constructor(
    public readonly code: LocalSavePathErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function getLocalSavesRoot(): string {
  const configured = process.env.HOI4_SAVES_DIR?.trim();
  return path.resolve(configured || path.join(process.cwd(), '..', 'saves'));
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export function resolveLocalSavePath(requestedPath: string): string {
  const root = getLocalSavesRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new LocalSavePathError(
      'root_unavailable',
      'Local saves directory is unavailable',
    );
  }

  const candidate = path.resolve(root, requestedPath);
  if (!isWithinRoot(root, candidate)) {
    throw new LocalSavePathError(
      'outside_root',
      'Save path must remain inside the local saves directory',
    );
  }

  if (path.extname(candidate).toLowerCase() !== '.hoi4') {
    throw new LocalSavePathError(
      'invalid_extension',
      'Only .hoi4 files can be analyzed from the local saves directory',
    );
  }

  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new LocalSavePathError('file_not_found', 'Local save file not found');
  }

  const realRoot = fs.realpathSync(root);
  const realCandidate = fs.realpathSync(candidate);
  if (!isWithinRoot(realRoot, realCandidate)) {
    throw new LocalSavePathError(
      'outside_root',
      'Save path must remain inside the local saves directory',
    );
  }

  return realCandidate;
}
