import { Injectable } from '@nestjs/common';
import {
  CampaignSnapshotProjectionCacheService,
  type CampaignEquipmentDefinitionProjection,
  type CampaignSnapshotProjection,
} from './campaign-snapshot-projection-cache.service';
import {
  PersistedAnalysisResultService,
  type PersistedResultFingerprint,
} from './persisted-analysis-result.service';
import {
  RecentAnalysesService,
  type RecentAnalysis,
} from './recent-analyses.service';
import type {
  CampaignTrend,
  CampaignTrendSnapshot,
  CampaignTrendsDto,
  CampaignEquipmentTrendsDto,
} from './campaign-trends.types';

/** Persisted membership/artifacts changed while a trends build was in flight. */
export class CampaignTrendsDataChangedError extends Error {
  constructor() {
    super('Campaign data changed while trends were being built');
    this.name = 'CampaignTrendsDataChangedError';
  }
}

type GameDate = readonly [number, number, number];

function gameDate(value: unknown): GameDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number) as [number, number, number];
  return parts[0] > 0 &&
    parts[1] >= 1 &&
    parts[1] <= 12 &&
    parts[2] >= 1 &&
    parts[2] <= 31
    ? parts
    : null;
}

function compareDates(left: GameDate, right: GameDate): number {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function compareSnapshots(
  left: Pick<CampaignTrendSnapshot, 'gameDate' | 'analyzedAt' | 'hash'>,
  right: Pick<CampaignTrendSnapshot, 'gameDate' | 'analyzedAt' | 'hash'>,
): number {
  const leftDate = gameDate(left.gameDate);
  const rightDate = gameDate(right.gameDate);
  if (leftDate && rightDate) {
    const dateOrder = compareDates(leftDate, rightDate);
    if (dateOrder !== 0) return dateOrder;
  } else if (leftDate) return -1;
  else if (rightDate) return 1;
  return (
    Date.parse(left.analyzedAt) - Date.parse(right.analyzedAt) ||
    left.hash.localeCompare(right.hash)
  );
}

function campaign(
  key: string,
  campaignId: string | null,
  playerCountryTags: ReadonlySet<string>,
  snapshots: CampaignTrendSnapshot[],
): CampaignTrend {
  snapshots.sort(compareSnapshots);
  const valid = snapshots.filter((entry) => gameDate(entry.gameDate));
  return {
    key,
    campaignId,
    playerCountryTag:
      playerCountryTags.size === 1 ? [...playerCountryTags][0] : null,
    relationship: campaignId ? 'known' : 'unknown',
    snapshotCount: snapshots.length,
    firstGameDate: valid[0]?.gameDate ?? null,
    latestGameDate: valid.at(-1)?.gameDate ?? null,
    gameVersions: [
      ...new Set(
        snapshots
          .map((entry) => entry.gameVersion)
          .filter((value): value is string => value !== null),
      ),
    ].sort(),
    snapshots,
  };
}

function snapshot(
  item: RecentAnalysis,
  projection: CampaignSnapshotProjection,
): CampaignTrendSnapshot {
  return {
    hash: item.hash,
    fileName: item.fileName,
    gameDate: projection.gameDate,
    analyzedAt: item.analyzedAt,
    gameVersion: projection.gameVersion,
    metrics: projection.metrics,
    countries: projection.countries,
  };
}

interface EquipmentSnapshot {
  item: RecentAnalysis;
  projection: CampaignSnapshotProjection;
}

function compareEquipmentSnapshots(
  left: EquipmentSnapshot,
  right: EquipmentSnapshot,
): number {
  return compareSnapshots(
    {
      hash: left.item.hash,
      gameDate: left.projection.gameDate,
      analyzedAt: left.item.analyzedAt,
    },
    {
      hash: right.item.hash,
      gameDate: right.projection.gameDate,
      analyzedAt: right.item.analyzedAt,
    },
  );
}

function equipmentDefinitions(
  projection: CampaignSnapshotProjection,
  countryTag: string,
): readonly CampaignEquipmentDefinitionProjection[] {
  return (
    projection.equipmentCountries.find(
      (entry) => entry.countryTag === countryTag,
    )?.definitions ?? []
  );
}

function equipmentValue(
  projection: CampaignSnapshotProjection,
  countryTag: string,
  equipmentDefinition: string,
): CampaignEquipmentDefinitionProjection | undefined {
  return equipmentDefinitions(projection, countryTag).find(
    (entry) => entry.equipmentDefinition === equipmentDefinition,
  );
}

function sameInventory(
  left: ReadonlyMap<string, PersistedResultFingerprint>,
  right: ReadonlyMap<string, PersistedResultFingerprint>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [hash, fingerprint] of left) {
    const other = right.get(hash);
    if (
      !other ||
      other.bytes !== fingerprint.bytes ||
      other.mtimeMs !== fingerprint.mtimeMs ||
      other.ctimeMs !== fingerprint.ctimeMs
    )
      return false;
  }
  return true;
}

@Injectable()
export class CampaignTrendsService {
  constructor(
    private readonly recent: RecentAnalysesService,
    private readonly results: PersistedAnalysisResultService,
    private readonly projections: CampaignSnapshotProjectionCacheService,
  ) {}

  async build(): Promise<CampaignTrendsDto> {
    return this.withStableInventory(
      () => this.recent.list(),
      async (items, inventory) => {
        const loaded = await this.loadAvailable(items, inventory);
        const groups = new Map<
          string,
          {
            campaignId: string | null;
            playerCountryTags: Set<string>;
            snapshots: CampaignTrendSnapshot[];
          }
        >();

        for (const item of items) {
          const projection = loaded.get(item.hash);
          if (!projection) continue;
          const campaignId = projection.campaignId;
          // Unknown legacy analyses stay isolated: sharing no UUID is not
          // evidence that they belong to one campaign.
          const key = campaignId
            ? `campaign:${campaignId}`
            : `unknown:${item.hash}`;
          const group = groups.get(key) ?? {
            campaignId,
            playerCountryTags: new Set<string>(),
            snapshots: [],
          };
          if (projection.playerCountryTag)
            group.playerCountryTags.add(projection.playerCountryTag);
          group.snapshots.push(snapshot(item, projection));
          groups.set(key, group);
        }

        const campaigns = [...groups.entries()]
          .map(([key, group]) =>
            campaign(
              key,
              group.campaignId,
              group.playerCountryTags,
              group.snapshots,
            ),
          )
          .sort(
            (left, right) =>
              right.snapshotCount - left.snapshotCount ||
              Number(right.relationship === 'known') -
                Number(left.relationship === 'known') ||
              left.key.localeCompare(right.key),
          );
        return {
          snapshotCount: campaigns.reduce(
            (total, entry) => total + entry.snapshotCount,
            0,
          ),
          campaigns,
        };
      },
    );
  }

  async buildEquipment(
    campaignKey: string,
    countryTag: string,
  ): Promise<CampaignEquipmentTrendsDto> {
    const targetCampaignId = campaignKey.startsWith('campaign:')
      ? campaignKey.slice('campaign:'.length)
      : null;
    const targetUnknownHash = campaignKey.startsWith('unknown:')
      ? campaignKey.slice('unknown:'.length)
      : null;
    const candidate = (item: RecentAnalysis): boolean => {
      if (targetUnknownHash && item.hash !== targetUnknownHash) return false;
      if (
        targetCampaignId &&
        item.campaignId &&
        item.campaignId !== targetCampaignId
      )
        return false;
      return true;
    };

    return this.withStableInventory(
      () => this.recent.list(),
      async (items, inventory) => {
        const loaded = await this.loadAvailable(
          items.filter(candidate),
          inventory,
        );
        const snapshots: EquipmentSnapshot[] = [];
        // Exact persisted campaign identity is re-checked from the loaded
        // projection; recent metadata is only a cheap pre-filter.
        for (const item of items) {
          if (!candidate(item)) continue;
          const projection = loaded.get(item.hash);
          if (!projection) continue;
          const key = projection.campaignId
            ? `campaign:${projection.campaignId}`
            : `unknown:${item.hash}`;
          if (key !== campaignKey) continue;
          snapshots.push({ item, projection });
        }
        snapshots.sort(compareEquipmentSnapshots);

        const definitions = [
          ...new Set(
            snapshots.flatMap(({ projection }) =>
              equipmentDefinitions(projection, countryTag).map(
                (entry) => entry.equipmentDefinition,
              ),
            ),
          ),
        ].sort((left, right) => left.localeCompare(right));

        return {
          campaignKey,
          countryTag,
          snapshotHashes: snapshots.map(({ item }) => item.hash),
          definitions: definitions.map((equipmentDefinition) => ({
            equipmentDefinition,
            stockpileBalance: snapshots.map(
              ({ projection }) =>
                equipmentValue(projection, countryTag, equipmentDefinition)
                  ?.stockpileBalance ?? null,
            ),
            activeFactories: snapshots.map(
              ({ projection }) =>
                equipmentValue(projection, countryTag, equipmentDefinition)
                  ?.activeFactories ?? null,
            ),
            currentItemsPerDay: snapshots.map(
              ({ projection }) =>
                equipmentValue(projection, countryTag, equipmentDefinition)
                  ?.currentItemsPerDay ?? null,
            ),
            productionRateComplete: snapshots.map(
              ({ projection }) =>
                equipmentValue(projection, countryTag, equipmentDefinition)
                  ?.productionRateComplete ?? null,
            ),
          })),
        };
      },
    );
  }

  /**
   * Load a projection for each requested hash exactly once per artifact
   * fingerprint, sequentially, reusing everything already cached. Full
   * AnalyzeResults are never retained by this service.
   */
  private async loadAvailable(
    items: readonly RecentAnalysis[],
    inventory: ReadonlyMap<string, PersistedResultFingerprint>,
  ): Promise<Map<string, CampaignSnapshotProjection>> {
    const loaded = new Map<string, CampaignSnapshotProjection>();
    for (const item of items) {
      const fingerprint = inventory.get(item.hash);
      if (!fingerprint) continue;
      const projection = await this.projections.ensure(item.hash, fingerprint);
      if (projection) loaded.set(item.hash, projection);
    }
    return loaded;
  }

  /**
   * Fingerprint the artifact store before and after a build. If a mutation
   * lands mid-build the whole response is discarded and rebuilt once against
   * the new state; a second mismatch fails through the controller so no
   * mixed-generation response is ever returned. Membership is re-listed on
   * every attempt so added/deleted snapshots participate in the retry.
   */
  private async withStableInventory<T>(
    list: () => Promise<RecentAnalysis[]>,
    build: (
      items: readonly RecentAnalysis[],
      inventory: ReadonlyMap<string, PersistedResultFingerprint>,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // list() reconciles recent metadata against the artifact store, so its
      // mutations are captured in the before-inventory below.
      const items = (await list()).filter((item) => item.hasPersistedResult);
      const before = await this.results.fingerprintInventory();
      this.projections.pruneMissing(new Set(before.keys()));
      const value = await build(items, before);
      const after = await this.results.fingerprintInventory();
      if (sameInventory(before, after)) return value;
    }
    throw new CampaignTrendsDataChangedError();
  }
}
