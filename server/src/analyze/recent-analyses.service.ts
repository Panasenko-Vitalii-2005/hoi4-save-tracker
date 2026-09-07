import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve, win32 } from 'node:path';
import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import {
  normalizeSaveComparisonContext,
  type SaveComparisonContext,
} from '../hoi4/save-comparison-context';
import type {
  AnalysisStorageCampaign,
  AnalysisStorageStatus,
} from './analysis-storage.types';
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
  campaignId?: string | null;
  playerCountryTag?: string | null;
}

export class PinnedCampaignAnalysesError extends Error {
  constructor(readonly pinnedCount: number) {
    super('Campaign includes pinned analyses');
  }
}

const CAMPAIGN_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function normalizeCampaignId(value: string): string | null {
  return CAMPAIGN_ID.test(value) ? value.toLowerCase() : null;
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
  const hasCampaignId = Object.prototype.hasOwnProperty.call(
    item,
    'campaignId',
  );
  const campaignId =
    item.campaignId === null
      ? null
      : typeof item.campaignId === 'string'
        ? normalizeCampaignId(item.campaignId)
        : undefined;
  const hasPlayerCountryTag = Object.prototype.hasOwnProperty.call(
    item,
    'playerCountryTag',
  );
  const playerCountryTag =
    item.playerCountryTag === null
      ? null
      : typeof item.playerCountryTag === 'string' &&
          /^[A-Z][A-Z0-9]{2}$/.test(item.playerCountryTag)
        ? item.playerCountryTag
        : undefined;
  if (
    (hasCampaignId && campaignId === undefined) ||
    (hasPlayerCountryTag && playerCountryTag === undefined)
  )
    throw new Error('Invalid history campaign metadata');
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
    ...(hasCampaignId ? { campaignId } : {}),
    ...(hasPlayerCountryTag ? { playerCountryTag } : {}),
  };
}

type GameDate = readonly [number, number, number];

function gameDate(value: string): GameDate | null {
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (!match) return null;
  const date = match.slice(1).map(Number) as [number, number, number];
  return date[0] > 0 &&
    date[1] >= 1 &&
    date[1] <= 12 &&
    date[2] >= 1 &&
    date[2] <= 31
    ? date
    : null;
}

function compareGameDates(left: string, right: string): number {
  const a = gameDate(left);
  const b = gameDate(right);
  if (!a) return b ? 1 : left.localeCompare(right);
  if (!b) return -1;
  for (let index = 0; index < a.length; index += 1)
    if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
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
  private readonly metricBackfillsAttempted = new Set<string>();
  private readonly contextBackfillsAttempted = new Set<string>();

  constructor(
    private readonly results: PersistedAnalysisResultService,
    @Optional() private readonly shares?: SharedAnalysesService,
  ) {
    const configured = Number(process.env.HOI4_RECENT_ANALYSES_LIMIT ?? 200);
    this.limit =
      Number.isSafeInteger(configured) && configured > 0 ? configured : 200;
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

  storageStatus(): Promise<AnalysisStorageStatus> {
    return this.enqueue(async () => {
      await this.reconcile();
      return this.buildStorageStatus();
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
    comparisonContext?: SaveComparisonContext,
    onPersisted?: () => Promise<void>,
  ): Promise<boolean> {
    return this.recordWithStatus(input, result, comparisonContext, onPersisted);
  }

  async recordWithStatus(
    input: Pick<RecentAnalysis, 'hash' | 'fileName' | 'fileSizeBytes'>,
    result: AnalyzeResult,
    comparisonContext?: SaveComparisonContext,
    onPersisted?: () => Promise<void>,
  ): Promise<boolean> {
    const context = normalizeSaveComparisonContext(comparisonContext);
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
      campaignId: context?.campaignId ?? null,
      playerCountryTag: context?.playerCountryTag ?? null,
    };
    let persisted = false;
    let onPersistedFailed = false;
    let onPersistedError: unknown;
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
            {
              preserveUnknown: !retention.reliable,
              comparisonContext,
            },
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
        persisted = next.includes(item) && item.hasPersistedResult;
        if (persisted && onPersisted)
          try {
            await onPersisted();
          } catch (error: unknown) {
            onPersistedFailed = true;
            onPersistedError = error;
          }
      });
    } catch {
      this.warnWrite();
      // A result written before a failed metadata commit must not become an orphan.
      await this.enqueue(() => this.reconcile());
      return false;
    }
    if (onPersistedFailed) throw onPersistedError;
    return persisted;
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

  deleteCampaign(
    campaignId: string,
    includePinned: boolean,
  ): Promise<string[]> {
    const key = normalizeCampaignId(campaignId);
    if (!key) throw new TypeError('Invalid campaign id');
    return this.enqueue(async () => {
      await this.reconcile();
      const targets = this.items.filter((item) => item.campaignId === key);
      const pinnedCount = targets.filter((item) => item.pinned).length;
      if (pinnedCount > 0 && !includePinned)
        throw new PinnedCampaignAnalysesError(pinnedCount);
      const deleted = new Set(targets.map((item) => item.hash));
      const next = this.items.filter((item) => !deleted.has(item.hash));
      await this.reconcileResults(next);
      await this.persist(next);
      this.items = next;
      return [...deleted];
    });
  }

  deleteUnpinned(): Promise<string[]> {
    return this.enqueue(async () => {
      await this.reconcile();
      const deleted = new Set(
        this.items.filter((item) => !item.pinned).map((item) => item.hash),
      );
      const next = this.items.filter((item) => !deleted.has(item.hash));
      await this.reconcileResults(next);
      await this.persist(next);
      this.items = next;
      return [...deleted];
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

  setPinnedStates(states: ReadonlyMap<string, boolean>): Promise<void> {
    return this.enqueue(async () => {
      if (states.size === 0) return;
      const next = this.retain(
        this.items.map((item) => {
          const pinned = states.get(item.hash);
          return pinned === undefined ? item : { ...item, pinned };
        }),
      );
      await this.persist(next);
      this.items = next;
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
      let changed = await this.backfillMissingMetadata(available);
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

  private async backfillMissingMetadata(
    available: ReadonlySet<string>,
  ): Promise<boolean> {
    let changed = false;
    for (const item of this.items) {
      const needsMetrics =
        (item.manpowerInField == null || item.aircraftCount == null) &&
        !this.metricBackfillsAttempted.has(item.hash);
      const needsContext =
        (item.campaignId === undefined ||
          item.playerCountryTag === undefined) &&
        !this.contextBackfillsAttempted.has(item.hash);
      if ((!needsMetrics && !needsContext) || !available.has(item.hash))
        continue;
      if (needsMetrics) this.metricBackfillsAttempted.add(item.hash);
      if (needsContext) this.contextBackfillsAttempted.add(item.hash);
      let result: AnalyzeResult | null = null;
      let context: SaveComparisonContext | null = null;
      if (needsMetrics && needsContext) {
        const persisted = await this.results
          .getWithContext(item.hash)
          .catch(() => null);
        result = persisted?.result ?? null;
        context = persisted?.comparisonContext ?? null;
      } else {
        if (needsMetrics)
          result = await this.results.get(item.hash).catch(() => null);
        if (needsContext)
          context = await this.results
            .getComparisonContext(item.hash)
            .catch(() => null);
      }
      if (needsMetrics && !result) {
        if (item.hasPersistedResult) {
          item.hasPersistedResult = false;
          changed = true;
        }
        continue;
      }
      if (
        result &&
        needsMetrics &&
        item.manpowerInField == null &&
        Number.isSafeInteger(result.totals.manpowerInField) &&
        result.totals.manpowerInField >= 0
      ) {
        item.manpowerInField = result.totals.manpowerInField;
        changed = true;
      }
      if (
        result &&
        needsMetrics &&
        item.aircraftCount == null &&
        Number.isSafeInteger(result.totals.aircraft) &&
        result.totals.aircraft >= 0
      ) {
        item.aircraftCount = result.totals.aircraft;
        changed = true;
      }
      if (needsContext && context) {
        item.campaignId = context.campaignId;
        item.playerCountryTag = context.playerCountryTag ?? null;
        changed = true;
      }
    }
    return changed;
  }

  private async buildStorageStatus(): Promise<AnalysisStorageStatus> {
    const storage = await this.results.storageStatus();
    const resultFiles = new Map(
      storage.files.map((file) => [file.hash, file.bytes]),
    );
    const shareProtection = this.shares
      ? await this.shares.protection()
      : { references: [], reliable: true };
    const shared = new Set(
      shareProtection.references.map((reference) => reference.hash),
    );
    const groups = new Map<string, RecentAnalysis[]>();
    for (const item of this.items) {
      if (!item.campaignId) continue;
      const group = groups.get(item.campaignId) ?? [];
      group.push(item);
      groups.set(item.campaignId, group);
    }
    const campaigns: AnalysisStorageCampaign[] = [...groups.entries()]
      .map(([campaignId, items]) => {
        const tags = new Set(
          items
            .map((item) => item.playerCountryTag)
            .filter((tag): tag is string => !!tag),
        );
        const dated = items
          .map((item) => item.gameDate)
          .filter((date) => gameDate(date))
          .sort(compareGameDates);
        return {
          campaignId,
          playerCountryTag: tags.size === 1 ? [...tags][0] : null,
          analysisCount: items.length,
          persistedAnalysisCount: items.filter((item) =>
            resultFiles.has(item.hash),
          ).length,
          pinnedAnalysisCount: items.filter((item) => item.pinned).length,
          sharedAnalysisCount: items.filter((item) => shared.has(item.hash))
            .length,
          resultBytes: items.reduce(
            (total, item) => total + (resultFiles.get(item.hash) ?? 0),
            0,
          ),
          firstGameDate: dated[0] ?? null,
          latestGameDate: dated.at(-1) ?? null,
        };
      })
      .sort(
        (left, right) =>
          right.analysisCount - left.analysisCount ||
          left.campaignId.localeCompare(right.campaignId),
      );
    const pinnedAnalysisCount = this.items.filter((item) => item.pinned).length;
    return {
      storageAccounting: 'global_physical_artifacts',
      storageLimitScope: 'global_physical_artifacts',
      recentAnalysisCount: this.items.length,
      persistedAnalysisCount: storage.files.length,
      persistedResultBytes: storage.totalBytes,
      maxPersistedResultBytes: storage.maxBytes,
      knownCampaignCount: campaigns.length,
      unknownCampaignAnalysisCount: this.items.filter(
        (item) => !item.campaignId,
      ).length,
      pinnedAnalysisCount,
      unpinnedAnalysisCount: this.items.length - pinnedAnalysisCount,
      sharedAnalysisCount: this.items.filter((item) => shared.has(item.hash))
        .length,
      cleanupEligibleCount: this.items.length - pinnedAnalysisCount,
      shareStatusReliable: shareProtection.reliable,
      campaigns,
    };
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
