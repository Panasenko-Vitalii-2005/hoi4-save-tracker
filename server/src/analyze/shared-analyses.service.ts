import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import {
  normalizeAnalysisHash,
  PersistedAnalysisResultService,
  type PersistedResultReference,
} from './persisted-analysis-result.service';

export interface SharedAnalysisLink {
  id: string;
  path: string;
}

interface SharedAnalysisRecord {
  id: string;
  hash: string;
  createdAt: string;
}

export interface SharedResultProtection {
  references: PersistedResultReference[];
  reliable: boolean;
}

export class SharedAnalysisLimitError extends Error {}

export class SharedAnalysisStorageError extends Error {}

const SHARE_ID_BYTES = 16;
const SHARE_ID_LENGTH = 22;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const DEFAULT_SHARE_LIMIT = 1000;

export function normalizeShareId(id: string): string | null {
  return id.length === SHARE_ID_LENGTH && SHARE_ID_PATTERN.test(id) ? id : null;
}

function readRecord(value: unknown): SharedAnalysisRecord {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid shared analysis record');
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? normalizeShareId(record.id) : null;
  const hash =
    typeof record.hash === 'string' ? normalizeAnalysisHash(record.hash) : null;
  if (
    !id ||
    !hash ||
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt))
  )
    throw new Error('Invalid shared analysis metadata');
  return {
    id,
    hash,
    createdAt: new Date(record.createdAt).toISOString(),
  };
}

@Injectable()
export class SharedAnalysesService {
  private readonly logger = new Logger(SharedAnalysesService.name);
  private readonly file = resolve(
    process.env.HOI4_SHARED_ANALYSES_FILE || 'data/shared-analyses.json',
  );
  private readonly limit: number;
  private records: SharedAnalysisRecord[] = [];
  private pending: Promise<void>;
  private protectionReliable = true;
  private readonly warned = new Set<string>();

  constructor(private readonly results: PersistedAnalysisResultService) {
    const configured = Number(
      process.env.HOI4_SHARED_ANALYSES_LIMIT ?? DEFAULT_SHARE_LIMIT,
    );
    this.limit =
      Number.isSafeInteger(configured) && configured > 0
        ? configured
        : DEFAULT_SHARE_LIMIT;
    this.pending = this.load();
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

  private async load(): Promise<void> {
    let needsRewrite = false;
    try {
      const stored: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        !stored ||
        typeof stored !== 'object' ||
        !('formatVersion' in stored) ||
        stored.formatVersion !== 1 ||
        !('items' in stored) ||
        !Array.isArray(stored.items)
      )
        throw new Error('Invalid shared analysis store');

      const ids = new Set<string>();
      const hashes = new Set<string>();
      const valid: SharedAnalysisRecord[] = [];
      for (const value of stored.items) {
        try {
          const record = readRecord(value);
          if (ids.has(record.id) || hashes.has(record.hash)) {
            needsRewrite = true;
            this.protectionReliable = false;
            continue;
          }
          ids.add(record.id);
          hashes.add(record.hash);
          valid.push(record);
        } catch {
          needsRewrite = true;
          this.protectionReliable = false;
        }
      }
      this.records = valid;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.protectionReliable = false;
      this.warn(
        'load',
        'Could not load shared analyses; public links are unavailable until the share store is repaired.',
      );
      return;
    }

    try {
      const available = await this.results.available(
        this.records.map((record) => record.hash),
      );
      const retained = this.records.filter((record) =>
        available.has(record.hash),
      );
      needsRewrite ||= retained.length !== this.records.length;
      this.records = retained;
      if (needsRewrite) await this.persist(this.records);
    } catch {
      this.protectionReliable = false;
      this.warn(
        'reconcile',
        'Could not reconcile shared analyses with persisted results; existing result files were preserved.',
      );
    }
  }

  protected generateId(): string {
    return randomBytes(SHARE_ID_BYTES).toString('base64url');
  }

  create(hash: string): Promise<SharedAnalysisLink | null> {
    const key = normalizeAnalysisHash(hash);
    if (!key) throw new TypeError('Invalid analysis hash');
    return this.enqueue(async () => {
      const existing = this.records.find((record) => record.hash === key);
      if (existing) {
        if (await this.results.exists(key)) return this.toLink(existing);
        const next = this.records.filter((record) => record !== existing);
        await this.persist(next);
        this.records = next;
        return null;
      }
      if (!(await this.results.exists(key))) return null;
      if (this.records.length >= this.limit)
        throw new SharedAnalysisLimitError(
          'Shared analysis limit has been reached',
        );

      let id: string | null = null;
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const candidate = this.generateId();
        if (
          normalizeShareId(candidate) &&
          !this.records.some((record) => record.id === candidate)
        ) {
          id = candidate;
          break;
        }
      }
      if (!id) throw new Error('Could not allocate a unique share identifier');
      const record: SharedAnalysisRecord = {
        id,
        hash: key,
        createdAt: new Date().toISOString(),
      };
      const next = [...this.records, record];
      try {
        await this.persist(next);
      } catch (error: unknown) {
        this.warn(
          'write',
          'Could not update shared analysis storage. Check storage permissions, space and configured limits.',
        );
        throw new SharedAnalysisStorageError(
          error instanceof Error ? error.message : 'Share storage failed',
        );
      }
      this.records = next;
      return this.toLink(record);
    });
  }

  getResult(id: string): Promise<AnalyzeResult | null> {
    const key = normalizeShareId(id);
    if (!key) return Promise.resolve(null);
    return this.enqueue(async () => {
      const record = this.records.find((entry) => entry.id === key);
      if (!record) return null;
      const result = await this.results.get(record.hash);
      if (result) return result;
      const next = this.records.filter((entry) => entry !== record);
      try {
        await this.persist(next);
        this.records = next;
      } catch {
        this.warn(
          'write',
          'Could not update shared analysis storage after a missing result was detected.',
        );
      }
      return null;
    });
  }

  revokeByHash(hash: string): Promise<boolean> {
    const key = normalizeAnalysisHash(hash);
    if (!key) throw new TypeError('Invalid analysis hash');
    return this.enqueue(async () => {
      const next = this.records.filter((record) => record.hash !== key);
      if (next.length === this.records.length) return false;
      try {
        await this.persist(next);
      } catch (error: unknown) {
        this.warn(
          'write',
          'Could not update shared analysis storage. Check storage permissions, space and configured limits.',
        );
        throw new SharedAnalysisStorageError(
          error instanceof Error ? error.message : 'Share storage failed',
        );
      }
      this.records = next;
      return true;
    });
  }

  hasHash(hash: string): Promise<boolean> {
    const key = normalizeAnalysisHash(hash);
    if (!key) return Promise.resolve(false);
    return this.enqueue(() =>
      Promise.resolve(this.records.some((record) => record.hash === key)),
    );
  }

  protection(): Promise<SharedResultProtection> {
    return this.enqueue(() =>
      Promise.resolve({
        references: this.records.map((record) => ({
          hash: record.hash,
          analyzedAt: record.createdAt,
          shared: true,
        })),
        reliable: this.protectionReliable,
      }),
    );
  }

  reconcileAvailable(available: ReadonlySet<string>): Promise<void> {
    return this.enqueue(async () => {
      const next = this.records.filter((record) => available.has(record.hash));
      if (next.length === this.records.length) return;
      try {
        await this.persist(next);
        this.records = next;
      } catch {
        this.warn(
          'write',
          'Could not remove stale public links from shared analysis storage.',
        );
      }
    });
  }

  private toLink(record: SharedAnalysisRecord): SharedAnalysisLink {
    return { id: record.id, path: `/share/${record.id}` };
  }

  private async persist(
    records: readonly SharedAnalysisRecord[],
  ): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(
          JSON.stringify({ formatVersion: 1, items: records }),
          'utf8',
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
