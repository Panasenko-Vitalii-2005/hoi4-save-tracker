import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve, win32 } from 'node:path';
import type { AnalyzeResult } from '../hoi4/hoi4-parser';

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

  constructor() {
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
      this.items = stored.items
        .map(readItem)
        .filter((item) => {
          if (seen.has(item.hash)) return false;
          seen.add(item.hash);
          return true;
        })
        .slice(0, this.limit);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          'Could not load recent analyses; starting with empty history. Check the configured history file.',
        );
      }
    }
  }

  async list(): Promise<RecentAnalysis[]> {
    await this.pending;
    return this.items.map((item) => ({ ...item }));
  }

  async record(
    input: Pick<RecentAnalysis, 'hash' | 'fileName' | 'fileSizeBytes'>,
    result: AnalyzeResult,
  ): Promise<void> {
    // Do not retain result in the write queue: metadata is the only stored data.
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
    };
    try {
      await this.enqueue(() =>
        [item, ...this.items.filter((old) => old.hash !== item.hash)].slice(
          0,
          this.limit,
        ),
      );
    } catch {
      if (!this.warnedWrite) {
        this.warnedWrite = true;
        this.logger.warn(
          'Could not save recent analyses; analysis results remain available. Check history storage permissions and free space.',
        );
      }
    }
  }

  clear(): Promise<void> {
    return this.enqueue(() => []);
  }

  private enqueue(next: () => RecentAnalysis[]): Promise<void> {
    const write = this.pending.then(async () => {
      const items = next();
      await this.persist(items);
      this.items = items;
    });
    // A failed write must not poison subsequent writes or reads.
    this.pending = write.catch(() => {});
    return write;
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
