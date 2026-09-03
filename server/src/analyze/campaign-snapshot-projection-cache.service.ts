import { Injectable } from '@nestjs/common';
import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import type { SaveComparisonContext } from '../hoi4/save-comparison-context';
import {
  PersistedAnalysisResultService,
  type PersistedResultFingerprint,
} from './persisted-analysis-result.service';
import type {
  CampaignTrendCountry,
  CampaignTrendMetrics,
} from './campaign-trends.types';

const DEFAULT_SNAPSHOT_LIMIT = 2048;
const DEFAULT_BYTE_LIMIT = 64 * 1024 * 1024;
// Fixed overhead per entry, on top of the serialized compact projection. Both
// are budget proxies for the live V8 heap, not exact heap measurement.
const ENTRY_BYTES_OVERHEAD = 512;

export interface CampaignEquipmentValues {
  stockpileBalance: number | null;
  activeFactories: number | null;
  currentItemsPerDay: number | null;
  productionRateComplete: boolean | null;
}

export interface CampaignEquipmentDefinitionProjection {
  equipmentDefinition: string;
  stockpileBalance: number | null;
  activeFactories: number | null;
  currentItemsPerDay: number | null;
  productionRateComplete: boolean | null;
}

export interface CampaignEquipmentCountryProjection {
  countryTag: string;
  definitions: CampaignEquipmentDefinitionProjection[];
}

/**
 * Compact, cacheable view of one persisted AnalyzeResult snapshot. It holds
 * only the fields required by Campaign Trends and Equipment Campaign Trends;
 * full results are released immediately after projection.
 */
export interface CampaignSnapshotProjection {
  hash: string;
  fingerprint: PersistedResultFingerprint;
  campaignId: string | null;
  playerCountryTag: string | null;
  gameDate: string;
  gameVersion: string | null;
  metrics: CampaignTrendMetrics;
  countries: CampaignTrendCountry[];
  equipmentCountries: CampaignEquipmentCountryProjection[];
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function add(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : finite(left + right);
}

function globalMetrics(result: AnalyzeResult): CampaignTrendMetrics {
  const totals = result.totals as unknown as Record<string, unknown>;
  return {
    activeCountries: finite(result.active_countries),
    divisions: finite(totals.divisions),
    manpowerInField: finite(totals.manpowerInField),
    aircraft: finite(totals.aircraft),
    ships: finite(totals.ships),
    militaryFactories: finite(totals.effectiveMilitaryFactories),
    civilianFactories: finite(totals.effectiveCivilianFactories),
    dockyards: finite(totals.effectiveDockyards),
  };
}

function trendCountries(result: AnalyzeResult): CampaignTrendCountry[] {
  const seen = new Set<string>();
  return result.by_country
    .filter((country) => {
      if (!country || typeof country.tag !== 'string' || seen.has(country.tag))
        return false;
      seen.add(country.tag);
      return true;
    })
    .map((country) => ({
      tag: country.tag,
      metrics: {
        divisions: finite(country.divisions),
        manpowerInField: finite(country.manpowerInField),
        aircraft: finite(country.aircraft),
        ships: finite(country.ships),
        militaryFactories: finite(country.effectiveMilitaryFactories),
        civilianFactories: finite(country.effectiveCivilianFactories),
        dockyards: finite(country.effectiveDockyards),
        calculatedCasualties: finite(country.calculatedWarCasualtiesTotal),
      },
    }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}

/**
 * Project the definition-level equipment values for every country in one pass.
 * The merge rules are identical to the original Campaign Trends projection:
 * definition identity is the exact string, all sums use finite-number add,
 * and the production rate is available only when every contributing line is
 * complete and finite.
 */
export function projectEquipmentCountries(
  result: AnalyzeResult,
): CampaignEquipmentCountryProjection[] {
  const byCountry = new Map<string, Map<string, CampaignEquipmentValues>>();
  const ensureCountry = (
    countryTag: string,
  ): Map<string, CampaignEquipmentValues> => {
    const current =
      byCountry.get(countryTag) ?? new Map<string, CampaignEquipmentValues>();
    byCountry.set(countryTag, current);
    return current;
  };
  const ensure = (
    values: Map<string, CampaignEquipmentValues>,
    definition: string,
  ): CampaignEquipmentValues => {
    const current = values.get(definition) ?? {
      stockpileBalance: null,
      activeFactories: null,
      currentItemsPerDay: null,
      productionRateComplete: null,
    };
    values.set(definition, current);
    return current;
  };

  for (const country of result.stockpileSummaries ?? []) {
    if (!country || typeof country.countryTag !== 'string') continue;
    for (const summary of country.definitions ?? []) {
      if (!summary || typeof summary.definition !== 'string') continue;
      const values = ensureCountry(country.countryTag);
      const current = ensure(values, summary.definition);
      const amount = finite(summary.amount);
      current.stockpileBalance =
        current.stockpileBalance === null
          ? amount
          : add(current.stockpileBalance, amount);
    }
  }

  for (const country of result.militaryProductionSummaries ?? []) {
    if (!country || typeof country.countryTag !== 'string') continue;
    for (const summary of country.definitions ?? []) {
      if (!summary || typeof summary.equipmentDefinition !== 'string') continue;
      const values = ensureCountry(country.countryTag);
      const current = ensure(values, summary.equipmentDefinition);
      const activeFactories = finite(summary.activeFactories);
      current.activeFactories =
        current.activeFactories === null
          ? activeFactories
          : add(current.activeFactories, activeFactories);

      const rate = finite(summary.currentItemsPerDay);
      const complete = summary.outputComplete === true && rate !== null;
      if (current.productionRateComplete === null) {
        current.productionRateComplete = complete;
        current.currentItemsPerDay = complete ? rate : null;
      } else {
        current.productionRateComplete =
          current.productionRateComplete && complete;
        current.currentItemsPerDay = current.productionRateComplete
          ? add(current.currentItemsPerDay, rate)
          : null;
      }
    }
  }

  return [...byCountry.entries()]
    .map(([countryTag, values]) => ({
      countryTag,
      definitions: [...values.entries()]
        .map(([equipmentDefinition, value]) => ({
          equipmentDefinition,
          stockpileBalance: value.stockpileBalance,
          activeFactories: value.activeFactories,
          currentItemsPerDay: value.currentItemsPerDay,
          productionRateComplete: value.productionRateComplete,
        }))
        .sort((left, right) =>
          left.equipmentDefinition.localeCompare(right.equipmentDefinition),
        ),
    }))
    .sort((left, right) => left.countryTag.localeCompare(right.countryTag));
}

export function projectSnapshot(
  hash: string,
  result: AnalyzeResult,
  context: SaveComparisonContext,
  fingerprint: PersistedResultFingerprint,
): CampaignSnapshotProjection {
  return {
    hash,
    fingerprint,
    campaignId: context.campaignId,
    playerCountryTag: context.playerCountryTag ?? null,
    gameDate: result.game_date,
    gameVersion: context.gameVersion,
    metrics: globalMetrics(result),
    countries: trendCountries(result),
    equipmentCountries: projectEquipmentCountries(result),
  };
}

function fingerprintEqual(
  left: PersistedResultFingerprint,
  right: PersistedResultFingerprint,
): boolean {
  return (
    left.bytes === right.bytes &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/**
 * Bounded, process-local cache of compact Campaign Trends snapshot
 * projections. Persisted gzip artifacts are read once per fingerprint; the
 * extracted projection is what stays in memory, never the full AnalyzeResult.
 */
@Injectable()
export class CampaignSnapshotProjectionCacheService {
  private readonly snapshots = new Map<string, CampaignSnapshotProjection>();
  private readonly entryEstimatedBytes = new Map<string, number>();
  private readonly inFlight = new Map<
    string,
    Promise<CampaignSnapshotProjection | null>
  >();
  private readonly snapshotLimit: number;
  private readonly byteLimit: number;
  private totalEstimatedBytes = 0;

  constructor(private readonly results: PersistedAnalysisResultService) {
    const snapshotConfigured = Number(
      process.env.HOI4_TRENDS_CACHE_SNAPSHOTS ?? DEFAULT_SNAPSHOT_LIMIT,
    );
    this.snapshotLimit =
      Number.isSafeInteger(snapshotConfigured) && snapshotConfigured > 0
        ? snapshotConfigured
        : DEFAULT_SNAPSHOT_LIMIT;
    const byteConfigured = Number(
      process.env.HOI4_TRENDS_CACHE_BYTES ?? DEFAULT_BYTE_LIMIT,
    );
    this.byteLimit =
      Number.isSafeInteger(byteConfigured) && byteConfigured > 0
        ? byteConfigured
        : DEFAULT_BYTE_LIMIT;
  }

  get size(): number {
    return this.snapshots.size;
  }

  get estimatedBytes(): number {
    return this.totalEstimatedBytes;
  }

  /**
   * Return the cached projection only when its artifact fingerprint still
   * matches. A fingerprint mismatch means the persisted artifact changed (or
   * was replaced) and the stale entry is dropped instead of being served.
   */
  getValid(
    hash: string,
    fingerprint: PersistedResultFingerprint,
  ): CampaignSnapshotProjection | null {
    const entry = this.snapshots.get(hash);
    if (!entry) return null;
    if (!fingerprintEqual(entry.fingerprint, fingerprint)) {
      this.delete(hash);
      return null;
    }
    // Touch for LRU ordering.
    this.snapshots.delete(hash);
    this.snapshots.set(hash, entry);
    return entry;
  }

  /**
   * Load a projection for one artifact exactly once per hash while identical
   * requests overlap. The full AnalyzeResult is released immediately after the
   * compact projection is extracted.
   */
  async ensure(
    hash: string,
    fingerprint: PersistedResultFingerprint,
  ): Promise<CampaignSnapshotProjection | null> {
    const cached = this.getValid(hash, fingerprint);
    if (cached) return cached;

    const pending = this.inFlight.get(hash);
    if (pending) {
      await pending;
      const after = this.getValid(hash, fingerprint);
      if (after) return after;
    }

    const promise = this.loadAndStore(hash, fingerprint);
    this.inFlight.set(hash, promise);
    try {
      const loaded = await promise;
      // Revalidates in case the same hash was loaded concurrently with a
      // different fingerprint and then evicted by that load.
      return this.getValid(hash, fingerprint) ?? loaded;
    } finally {
      if (this.inFlight.get(hash) === promise) this.inFlight.delete(hash);
    }
  }

  /**
   * Remove entries whose artifact no longer exists in the current inventory.
   * Deleted snapshots can therefore never be served from memory.
   */
  pruneMissing(available: ReadonlySet<string>): void {
    for (const hash of [...this.snapshots.keys()])
      if (!available.has(hash)) this.delete(hash);
  }

  /** Forget everything; used by tests and deliberately simple to reason about. */
  clear(): void {
    this.snapshots.clear();
    this.entryEstimatedBytes.clear();
    this.totalEstimatedBytes = 0;
  }

  private async loadAndStore(
    hash: string,
    fingerprint: PersistedResultFingerprint,
  ): Promise<CampaignSnapshotProjection | null> {
    const persisted = await this.results.getWithContext(hash);
    if (!persisted) return null;
    const projection = projectSnapshot(
      hash,
      persisted.result,
      persisted.comparisonContext,
      fingerprint,
    );
    this.set(projection);
    return projection;
  }

  private set(projection: CampaignSnapshotProjection): void {
    if (this.snapshots.has(projection.hash)) this.delete(projection.hash);
    const estimate =
      Buffer.byteLength(JSON.stringify(projection)) + ENTRY_BYTES_OVERHEAD;
    this.snapshots.set(projection.hash, projection);
    this.entryEstimatedBytes.set(projection.hash, estimate);
    this.totalEstimatedBytes += estimate;
    this.evict();
  }

  private delete(hash: string): void {
    const estimate = this.entryEstimatedBytes.get(hash) ?? 0;
    this.snapshots.delete(hash);
    this.entryEstimatedBytes.delete(hash);
    this.totalEstimatedBytes = Math.max(0, this.totalEstimatedBytes - estimate);
  }

  private evict(): void {
    while (
      this.snapshots.size > this.snapshotLimit ||
      this.totalEstimatedBytes > this.byteLimit
    ) {
      const oldest = this.snapshots.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}
