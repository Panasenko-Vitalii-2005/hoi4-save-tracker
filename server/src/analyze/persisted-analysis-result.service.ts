import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createGunzip, gzip, gunzip } from 'node:zlib';
import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import {
  normalizeSaveComparisonContext,
  unknownSaveComparisonContext,
  type SaveComparisonContext,
} from '../hoi4/save-comparison-context';

export interface PersistedAnalysisResultV1 {
  formatVersion: 1;
  hash: string;
  savedAt: string;
  result: AnalyzeResult;
}

export interface PersistedAnalysisResultV2 {
  formatVersion: 2;
  hash: string;
  savedAt: string;
  comparisonContext: SaveComparisonContext;
  result: AnalyzeResult;
}

export interface PersistedAnalysis {
  result: AnalyzeResult;
  comparisonContext: SaveComparisonContext;
}

export interface PersistedResultReference {
  hash: string;
  analyzedAt: string;
  pinned?: boolean;
  shared?: boolean;
}

export interface PersistedResultRetentionOptions {
  preserveUnknown?: boolean;
  comparisonContext?: SaveComparisonContext;
}
interface ResultFile {
  hash: string;
  bytes: number;
  modified: number;
  changed: number;
}

/** Filesystem identity of one persisted artifact; never inflated by itself. */
export interface PersistedResultFingerprint {
  bytes: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface PersistedResultStorageStatus {
  maxBytes: number;
  totalBytes: number;
  files: ReadonlyArray<{
    hash: string;
    bytes: number;
  }>;
}

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
// Bound corrupt gzip expansion too. Oversized successful results still reach POST callers.
const MAX_JSON_BYTES = 512 * 1024 * 1024;
const MAX_CONTEXT_PREFIX_BYTES = 64 * 1024;

export function normalizeAnalysisHash(hash: string): string | null {
  return hash.length === 64 && /^[a-fA-F0-9]{64}$/.test(hash)
    ? hash.toLowerCase()
    : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Envelope validation is deliberately independent of parser implementation.
function isResult(value: unknown): value is AnalyzeResult {
  if (!isObject(value) || typeof value.game_date !== 'string') return false;
  if (
    !['parse_seconds', 'file_size_mb', 'active_countries'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    )
  )
    return false;
  if (
    !['totals', 'equipment_by_country', 'world_equipment'].every((key) =>
      isObject(value[key]),
    )
  )
    return false;
  return [
    'by_country',
    'stockpileSummaries',
    'militaryProductionSummaries',
    'divisionSummaries',
    'divisionTemplateCatalog',
    'divisionEquipmentCatalog',
    'armyHierarchySummaries',
    'navalLosses',
    'navalLossSummaries',
    'navalKills',
    'navalKillSummaries',
    'navalKillerShipSummaries',
  ].every((key) => Array.isArray(value[key]));
}

@Injectable()
export class PersistedAnalysisResultService {
  private readonly logger = new Logger(PersistedAnalysisResultService.name);
  private readonly directory = resolve(
    process.env.HOI4_ANALYSIS_RESULTS_DIR || 'data/analysis-results',
  );
  private readonly maxBytes: number;
  private pending: Promise<void> = Promise.resolve();
  private readonly warned = new Set<string>();
  private readonly invalid = new Set<string>();

  constructor() {
    const configured = Number(
      process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES ?? DEFAULT_MAX_BYTES,
    );
    this.maxBytes =
      Number.isSafeInteger(configured) && configured > 0
        ? configured
        : DEFAULT_MAX_BYTES;
  }

  private key(hash: string): string {
    const key = normalizeAnalysisHash(hash);
    if (!key) throw new TypeError('Invalid analysis hash');
    return key;
  }

  private path(hash: string): string {
    return join(this.directory, `${this.key(hash)}.json.gz`);
  }

  private warn(kind: string, message: string): void {
    if (!this.warned.has(kind)) {
      this.warned.add(kind);
      this.logger.warn(message);
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.pending.then(work);
    this.pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  private async checkDirectory(create = false): Promise<boolean> {
    if (create) await mkdir(this.directory, { recursive: true });
    try {
      const entry = await lstat(this.directory);
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error('Unsafe results directory');
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async exists(hash: string): Promise<boolean> {
    const key = this.key(hash);
    await this.pending;
    try {
      if (this.invalid.has(key) || !(await this.checkDirectory())) return false;
      const entry = await lstat(this.path(key));
      return entry.isFile() && !entry.isSymbolicLink();
    } catch {
      return false;
    }
  }

  async get(hash: string): Promise<AnalyzeResult | null> {
    return (await this.readPersisted(hash))?.result ?? null;
  }

  async getWithContext(hash: string): Promise<PersistedAnalysis | null> {
    return this.readPersisted(hash);
  }

  /** Read V2 comparison context from the small envelope prefix only. */
  async getComparisonContext(
    hash: string,
  ): Promise<SaveComparisonContext | null> {
    const key = this.key(hash);
    await this.pending;
    let source: ReturnType<typeof createReadStream> | null = null;
    let inflation: ReturnType<typeof createGunzip> | null = null;
    try {
      if (!(await this.checkDirectory())) return null;
      const file = this.path(key);
      const entry = await lstat(file);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        entry.size > this.maxBytes
      )
        return null;
      source = createReadStream(file, { highWaterMark: 4096 });
      inflation = createGunzip();
      source.pipe(inflation);
      let bytes = Buffer.alloc(0);
      for await (const chunk of inflation) {
        bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
        if (bytes.length > MAX_CONTEXT_PREFIX_BYTES) return null;
        const prefix = bytes.toString('utf8');
        const boundary = prefix.indexOf(',"result":');
        if (boundary < 0) continue;
        const envelope: unknown = JSON.parse(`${prefix.slice(0, boundary)}}`);
        if (
          !isObject(envelope) ||
          ![1, 2].includes(envelope.formatVersion as number) ||
          envelope.hash !== key ||
          typeof envelope.savedAt !== 'string' ||
          !Number.isFinite(Date.parse(envelope.savedAt))
        )
          return null;
        return envelope.formatVersion === 1
          ? unknownSaveComparisonContext()
          : normalizeSaveComparisonContext(envelope.comparisonContext);
      }
      return null;
    } catch {
      return null;
    } finally {
      source?.destroy();
      inflation?.destroy();
    }
  }

  private async readPersisted(hash: string): Promise<PersistedAnalysis | null> {
    const key = this.key(hash);
    await this.pending;
    try {
      if (!(await this.checkDirectory())) return null;
      const file = this.path(key);
      const entry = await lstat(file);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        entry.size > this.maxBytes
      )
        throw new Error('Unsafe result file');
      const json = await decompress(await readFile(file), {
        maxOutputLength: MAX_JSON_BYTES,
      });
      const envelope: unknown = JSON.parse(json.toString('utf8'));
      if (
        !isObject(envelope) ||
        ![1, 2].includes(envelope.formatVersion as number) ||
        envelope.hash !== key ||
        typeof envelope.savedAt !== 'string' ||
        !Number.isFinite(Date.parse(envelope.savedAt)) ||
        !isResult(envelope.result)
      )
        throw new Error('Invalid persisted analysis');
      const comparisonContext =
        envelope.formatVersion === 1
          ? unknownSaveComparisonContext()
          : normalizeSaveComparisonContext(envelope.comparisonContext);
      if (!comparisonContext) throw new Error('Invalid persisted analysis');
      this.invalid.delete(key);
      return { result: envelope.result, comparisonContext };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.invalid.add(key);
        this.warn(
          'read',
          'A persisted analysis is unavailable or incompatible. Re-analyze the original save to replace it.',
        );
      }
      return null;
    }
  }

  async save(
    hash: string,
    result: AnalyzeResult,
    recent: readonly PersistedResultReference[] = [],
    options: PersistedResultRetentionOptions = {},
  ): Promise<boolean> {
    const key = this.key(hash);
    return this.enqueue(async () => {
      try {
        const envelope: PersistedAnalysisResultV2 = {
          formatVersion: 2,
          hash: key,
          savedAt: new Date().toISOString(),
          comparisonContext:
            normalizeSaveComparisonContext(options.comparisonContext) ??
            unknownSaveComparisonContext(),
          result,
        };
        const json = JSON.stringify(envelope);
        if (Buffer.byteLength(json) > MAX_JSON_BYTES)
          throw new Error('Result JSON exceeds safety limit');
        const bytes = await compress(json);
        if (bytes.length > this.maxBytes)
          throw new Error('Result exceeds disk budget');
        await this.checkDirectory(true);
        const files = await this.inventory();
        // Reserve space before writing. Failed cleanup must not allow growth.
        const admitted = await this.enforceBudget(
          files,
          recent,
          {
            hash: key,
            bytes: bytes.length,
          },
          options.preserveUnknown === true,
        );
        if (!admitted) return false;
        const destination = this.path(key);
        try {
          const previous = await lstat(destination);
          if (!previous.isFile() || previous.isSymbolicLink())
            throw new Error('Unsafe destination');
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const temporary = `${destination}.${randomUUID()}.tmp`;
        const handle = await open(temporary, 'wx', 0o600);
        try {
          try {
            await handle.writeFile(bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(temporary, destination);
        } finally {
          await unlink(temporary).catch(() => {});
        }
        this.invalid.delete(key);
        return true;
      } catch {
        this.warn(
          'write',
          'Could not persist an analysis result. Current analysis remains available; check storage permissions, space and configured limits.',
        );
        return false;
      }
    });
  }

  delete(hash: string): Promise<void> {
    const key = this.key(hash);
    return this.enqueue(async () => {
      await this.remove(key);
    });
  }

  private async remove(hash: string): Promise<void> {
    if (!(await this.checkDirectory())) return;
    try {
      const file = this.path(hash);
      const entry = await lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error('Unsafe result deletion');
      await unlink(file);
      this.invalid.delete(hash);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async inventory(): Promise<ResultFile[]> {
    if (!(await this.checkDirectory())) return [];
    const found: ResultFile[] = [];
    for (const entry of await readdir(this.directory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json\.gz$/.test(entry.name))
        continue;
      const stats = await lstat(join(this.directory, entry.name));
      if (stats.isFile() && !stats.isSymbolicLink())
        found.push({
          hash: entry.name.slice(0, 64),
          bytes: stats.size,
          modified: stats.mtimeMs,
          changed: stats.ctimeMs,
        });
    }
    return found;
  }

  /** Lightweight compressed-artifact inventory; never reads or inflates results. */
  async storageStatus(): Promise<PersistedResultStorageStatus> {
    await this.pending;
    const files = (await this.inventory()).sort((left, right) =>
      left.hash.localeCompare(right.hash),
    );
    return {
      maxBytes: this.maxBytes,
      totalBytes: files.reduce((total, file) => total + file.bytes, 0),
      files: files.map(({ hash, bytes }) => ({ hash, bytes })),
    };
  }

  /**
   * Read-only artifact fingerprints for cache revalidation. Never inflates or
   * mutates results; only filesystem metadata is observed.
   */
  async fingerprintInventory(): Promise<
    Map<string, PersistedResultFingerprint>
  > {
    await this.pending;
    return new Map(
      (await this.inventory()).map((file) => [
        file.hash,
        {
          bytes: file.bytes,
          mtimeMs: file.modified,
          ctimeMs: file.changed,
        },
      ]),
    );
  }

  /** Read-only existence reconciliation for share metadata startup. */
  async available(hashes: readonly string[]): Promise<Set<string>> {
    const wanted = new Set(hashes.map((hash) => this.key(hash)));
    await this.pending;
    return new Set(
      (await this.inventory())
        .filter((file) => wanted.has(file.hash) && !this.invalid.has(file.hash))
        .map((file) => file.hash),
    );
  }

  private async enforceBudget(
    files: ResultFile[],
    recent: readonly PersistedResultReference[],
    incoming?: { hash: string; bytes: number },
    preserveUnknown = false,
  ): Promise<boolean> {
    const metadata = new Map(recent.map((entry) => [entry.hash, entry]));
    const candidates = files.filter((file) => file.hash !== incoming?.hash);
    if (incoming)
      candidates.push({
        ...incoming,
        modified: Date.now(),
        changed: Date.now(),
      });
    let total = candidates.reduce((sum, file) => sum + file.bytes, 0);
    const timestamp = (file: ResultFile) => {
      const entry = metadata.get(file.hash);
      return entry ? Date.parse(entry.analyzedAt) : file.modified;
    };
    const oldest = candidates.sort(
      (a, b) =>
        this.protectionRank(a.hash, metadata, preserveUnknown) -
          this.protectionRank(b.hash, metadata, preserveUnknown) ||
        timestamp(a) - timestamp(b) ||
        a.hash.localeCompare(b.hash),
    );
    const evicted: ResultFile[] = [];
    for (const file of oldest) {
      if (total <= this.maxBytes) break;
      // A new ordinary result cannot displace pins or shares. Decide before deleting.
      if (file.hash === incoming?.hash) return false;
      evicted.push(file);
      total -= file.bytes;
    }
    for (const file of evicted) await this.remove(file.hash);
    return true;
  }

  private protectionRank(
    hash: string,
    metadata: ReadonlyMap<string, PersistedResultReference>,
    preserveUnknown: boolean,
  ): number {
    const entry = metadata.get(hash);
    if (entry?.shared === true || (preserveUnknown && !entry)) return 2;
    return entry?.pinned === true ? 1 : 0;
  }

  /** Reconcile only this service's regular files, never arbitrary files or links. */
  reconcile(
    recent: readonly PersistedResultReference[],
    options: PersistedResultRetentionOptions = {},
  ): Promise<Set<string>> {
    return this.enqueue(async () => {
      const wanted = new Set(recent.map((entry) => this.key(entry.hash)));
      const files = await this.inventory();
      for (const file of files)
        if (!options.preserveUnknown && !wanted.has(file.hash))
          await this.remove(file.hash);
      const retained = options.preserveUnknown
        ? files
        : files.filter((file) => wanted.has(file.hash));
      await this.enforceBudget(
        retained,
        recent,
        undefined,
        options.preserveUnknown === true,
      );
      if (await this.checkDirectory()) {
        for (const entry of await readdir(this.directory, {
          withFileTypes: true,
        })) {
          if (
            entry.isFile() &&
            /^[a-f0-9]{64}\.json\.gz\.[a-f0-9-]{36}\.tmp$/.test(entry.name)
          ) {
            const file = join(this.directory, entry.name);
            const info = await lstat(file);
            if (info.isFile() && !info.isSymbolicLink()) await unlink(file);
          }
        }
      }
      return new Set(
        (await this.inventory())
          .filter((file) => !this.invalid.has(file.hash))
          .map((file) => file.hash),
      );
    });
  }
}
