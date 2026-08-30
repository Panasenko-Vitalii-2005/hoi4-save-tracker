import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve, win32 } from 'node:path';
import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import {
  PersistedAnalysisResultService,
  type PersistedResultReference,
} from './persisted-analysis-result.service';
import { SharedAnalysesService } from './shared-analyses.service';

export interface RecentAnalysis {
  hash: string;
  fileName: string;
  fileSizeBytes: number;
  analyzedAt: string;
  gameDate: string;
  countryCount: number;
  divisionCount: number;
  shipCount: number;
  navalLossCount: number;
  manpowerInField: number | null;
  aircraftCount: number | null;
  hasPersistedResult: boolean;
  pinned: boolean;
}

function safeFileName(name: string): string {
  return win32.basename(basename(name)) || 'Unnamed save';
}

// Reconstruct the whitelist on load too: never serve arbitrary fields from disk.
function readItem(value: unknown): RecentAnalysis {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid history item');
  const item = value as Record<string, unknown>;
  const count = (key: string): number => {
    const value = item[key];
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error('Invalid history count');
    }
    return value;
  };
  const optionalCount = (key: string): number | null =>
    item[key] == null ? null : count(key);
  if (
    typeof item.hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.hash) ||
    typeof item.fileName !== 'string' ||
    typeof item.analyzedAt !== 'string' ||
    !Number.isFinite(Date.parse(item.analyzedAt)) ||
    typeof item.gameDate !== 'string'
  )
    throw new Error('Invalid history metadata');
  return {
    hash: item.hash,
    fileName: safeFileName(item.fileName),
    fileSizeBytes: count('fileSizeBytes'),
    analyzedAt: new Date(item.analyzedAt).toISOString(),
    gameDate: item.gameDate,
    countryCount: count('countryCount'),
    divisionCount: count('divisionCount'),
    shipCount: count('shipCount'),
    navalLossCount: count('navalLossCount'),
    manpowerInField: optionalCount('manpowerInField'),
    aircraftCount: optionalCount('aircraftCount'),
    hasPersistedResult: item.hasPersistedResult === true,
    pinned: item.pinned === true,
  };
}

@Injectable()
export class RecentAnalysesService {
  private readonly logger = new Logger(RecentAnalysesService.name);
  private readonly file = resolve(
    process.env.HOI4_RECENT_ANALYSES_FILE || 'data/recent-analyses.json',
  );
  private readonly limit: number;
  private items: RecentAnalysis[] = [];
  private pending: Promise<void>;
  private warnedWrite = false;

  constructor(
    private readonly results: PersistedAnalysisResultService,
    @Optional() private readonly shares?: SharedAnalysesService,
  ) {
    const configured = Number(process.env.HOI4_RECENT_ANALYSES_LIMIT ?? 20);
    this.limit =
      Number.isSafeInteger(configured) && configured > 0 ? configured : 20;
    this.pending = this.load();
  }

  private async load(): Promise<void> {
    try {
      const stored: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        !stored ||
        typeof stored !== 'object' ||
        !('items' in stored) ||
        !Array.isArray(stored.items)
      ) {
        throw new Error('Invalid history file');
      }
      const seen = new Set<string>();
      this.items = this.retain(
        stored.items.map(readItem).filter((item) => {
          if (seen.has(item.hash)) return false;
          seen.add(item.hash);
          return true;
        }),
      );
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          'Could not load recent analyses; starting with empty history. Check the configured history file.',
        );
      }
    }
    await this.reconcile();
  }

  list(): Promise<RecentAnalysis[]> {
    return this.enqueue(async () => {
      await this.reconcile();
      return this.items.map((item) => ({ ...item }));
    });
  }

  getResult(hash: string): Promise<AnalyzeResult | null> {
    return this.enqueue(async () => {
      const item = this.items.find((item) => item.hash === hash);
      if (!item?.hasPersistedResult) return null;
      const result = await this.results.get(hash);
      if (!result) {
        item.hasPersistedResult = false;
        await this.persist(this.items).catch(() => this.warnWrite());
        await this.reconcile();
      }
      return result;
    });
  }

  async record(
    input: Pick<RecentAnalysis, 'hash' | 'fileName' | 'fileSizeBytes'>,
    result: AnalyzeResult,
  ): Promise<void> {
    const item: RecentAnalysis = {
      hash: input.hash,
      fileName: safeFileName(input.fileName),
      fileSizeBytes: input.fileSizeBytes,
      analyzedAt: new Date().toISOString(),
      gameDate: result.game_date,
      countryCount: result.active_countries,
      divisionCount: result.totals.divisions,
      shipCount: result.totals.ships,
      navalLossCount: result.navalLosses.length,
      manpowerInField: result.totals.manpowerInField,
      aircraftCount: result.totals.aircraft,
      hasPersistedResult: false,
      pinned: false,
    };
    try {
      await this.enqueue(async () => {
        // Read the latest pin state inside the mutation queue, not at request start.
        item.pinned =
          this.items.find((old) => old.hash === item.hash)?.pinned ?? false;
        const next = this.retain([
          item,
          ...this.items.filter((old) => old.hash !== item.hash),
        ]);
        const retention = await this.retention(next);
        if (next.includes(item)) {
          item.hasPersistedResult = await this.results.save(
            item.hash,
            result,
            retention.references,
            { preserveUnknown: !retention.reliable },
          );
        }
        const available = await this.reconcileResults(next).catch(() => {
          this.warnWrite();
          return new Set<string>();
        });
        for (const entry of next)
          entry.hasPersistedResult &&= available.has(entry.hash);
        await this.persist(next);
        this.items = next;
      });
    } catch {
      this.warnWrite();
      // A result written before a failed metadata commit must not become an orphan.
      await this.enqueue(() => this.reconcile());
    }
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.reconcileResults([]);
      await this.persist([]);
      this.items = [];
    });
  }

  delete(hash: string): Promise<void> {
    return this.enqueue(async () => {
      const next = this.items.filter((item) => item.hash !== hash);
      await this.reconcileResults(next);
      await this.persist(next);
      this.items = next;
    });
  }

  setPinned(hash: string, pinned: boolean): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.items.some((item) => item.hash === hash)) return false;
      const next = this.retain(
        this.items.map((item) =>
          item.hash === hash ? { ...item, pinned } : item,
        ),
      );
      await this.persist(next);
      this.items = next;
      return true;
    });
  }

  revokeShare(hash: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.shares) return false;
      const revoked = await this.shares.revokeByHash(hash);
      await this.reconcileResults(this.items);
      return revoked;
    });
  }

  private retain(items: RecentAnalysis[]): RecentAnalysis[] {
    // The total count includes pins. Stable ties preserve same-time source order.
    return [...items]
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          Date.parse(b.analyzedAt) - Date.parse(a.analyzedAt),
      )
      .slice(0, this.limit);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const write = this.pending.then(work);
    // A failed write must not poison subsequent writes or reads.
    this.pending = write.then(
      () => {},
      () => {},
    );
    return write;
  }

  private warnWrite(): void {
    if (!this.warnedWrite) {
      this.warnedWrite = true;
      this.logger.warn(
        'Could not update recent analysis storage; current analysis remains available. Check storage permissions, space and configured limits.',
      );
    }
  }

  private async reconcile(): Promise<void> {
    try {
      const available = await this.reconcileResults(this.items);
      let changed = false;
      for (const item of this.items) {
        if (item.hasPersistedResult && !available.has(item.hash)) {
          item.hasPersistedResult = false;
          changed = true;
        }
      }
      if (changed) await this.persist(this.items);
    } catch {
      // Do not advertise unavailable storage, even if metadata cannot be updated.
      for (const item of this.items) item.hasPersistedResult = false;
      this.warnWrite();
    }
  }

  private async retention(items: readonly RecentAnalysis[]): Promise<{
    references: PersistedResultReference[];
    reliable: boolean;
  }> {
    if (!this.shares) return { references: [...items], reliable: true };
    const protection = await this.shares.protection();
    return {
      references: [...items, ...protection.references],
      reliable: protection.reliable,
    };
  }

  private async reconcileResults(
    items: readonly RecentAnalysis[],
  ): Promise<Set<string>> {
    const retention = await this.retention(items);
    const available = await this.results.reconcile(retention.references, {
      preserveUnknown: !retention.reliable,
    });
    await this.shares?.reconcileAvailable(available);
    return available;
  }

  private async persist(items: RecentAnalysis[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify({ items }), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.file);
    } finally {
      // Only this operation's temporary file; never remove the existing store.
      await unlink(temporary).catch(() => {});
    }
  }
}
