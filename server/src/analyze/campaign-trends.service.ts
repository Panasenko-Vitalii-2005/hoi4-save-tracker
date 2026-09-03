import { Injectable } from '@nestjs/common';
import type { AnalyzeResult, CountryStats } from '../hoi4/hoi4-parser';
import type { SaveComparisonContext } from '../hoi4/save-comparison-context';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import {
  RecentAnalysesService,
  type RecentAnalysis,
} from './recent-analyses.service';
import type {
  CampaignTrend,
  CampaignTrendCountry,
  CampaignTrendMetrics,
  CampaignTrendSnapshot,
  CampaignTrendsDto,
  CampaignEquipmentTrendsDto,
  CountryTrendMetrics,
} from './campaign-trends.types';

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

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function add(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : finite(left + right);
}

interface EquipmentSnapshot {
  item: RecentAnalysis;
  result: AnalyzeResult;
}

interface EquipmentValues {
  stockpileBalance: number | null;
  activeFactories: number | null;
  currentItemsPerDay: number | null;
  productionRateComplete: boolean | null;
}

function equipmentValuesByDefinition(
  result: AnalyzeResult,
  countryTag: string,
): Map<string, EquipmentValues> {
  const values = new Map<string, EquipmentValues>();
  const ensure = (definition: string): EquipmentValues => {
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
    if (country?.countryTag !== countryTag) continue;
    for (const summary of country.definitions ?? []) {
      if (!summary || typeof summary.definition !== 'string') continue;
      const current = ensure(summary.definition);
      const amount = finite(summary.amount);
      current.stockpileBalance =
        current.stockpileBalance === null
          ? amount
          : add(current.stockpileBalance, amount);
    }
  }

  for (const country of result.militaryProductionSummaries ?? []) {
    if (country?.countryTag !== countryTag) continue;
    for (const summary of country.definitions ?? []) {
      if (!summary || typeof summary.equipmentDefinition !== 'string') continue;
      const current = ensure(summary.equipmentDefinition);
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
  return values;
}

function compareEquipmentSnapshots(
  left: EquipmentSnapshot,
  right: EquipmentSnapshot,
): number {
  return compareSnapshots(
    {
      hash: left.item.hash,
      gameDate: left.result.game_date,
      analyzedAt: left.item.analyzedAt,
    },
    {
      hash: right.item.hash,
      gameDate: right.result.game_date,
      analyzedAt: right.item.analyzedAt,
    },
  );
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

function countryMetrics(country: CountryStats): CountryTrendMetrics {
  const record = country as unknown as Record<string, unknown>;
  return {
    divisions: finite(record.divisions),
    manpowerInField: finite(record.manpowerInField),
    aircraft: finite(record.aircraft),
    ships: finite(record.ships),
    militaryFactories: finite(record.effectiveMilitaryFactories),
    civilianFactories: finite(record.effectiveCivilianFactories),
    dockyards: finite(record.effectiveDockyards),
    calculatedCasualties: finite(record.calculatedWarCasualtiesTotal),
  };
}

function countries(result: AnalyzeResult): CampaignTrendCountry[] {
  const seen = new Set<string>();
  return result.by_country
    .filter((country) => {
      if (!country || typeof country.tag !== 'string' || seen.has(country.tag))
        return false;
      seen.add(country.tag);
      return true;
    })
    .map((country) => ({ tag: country.tag, metrics: countryMetrics(country) }))
    .sort((left, right) => left.tag.localeCompare(right.tag));
}

function snapshot(
  item: RecentAnalysis,
  result: AnalyzeResult,
  context: SaveComparisonContext,
): CampaignTrendSnapshot {
  return {
    hash: item.hash,
    fileName: item.fileName,
    gameDate: result.game_date,
    analyzedAt: item.analyzedAt,
    gameVersion: context.gameVersion,
    metrics: globalMetrics(result),
    countries: countries(result),
  };
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

@Injectable()
export class CampaignTrendsService {
  constructor(
    private readonly recent: RecentAnalysesService,
    private readonly results: PersistedAnalysisResultService,
  ) {}

  async build(): Promise<CampaignTrendsDto> {
    const items = (await this.recent.list()).filter(
      (item) => item.hasPersistedResult,
    );
    const groups = new Map<
      string,
      {
        campaignId: string | null;
        playerCountryTags: Set<string>;
        snapshots: CampaignTrendSnapshot[];
      }
    >();

    // Load sequentially so a history containing large AnalyzeResults does not
    // multiply peak memory. No save file, parser, cache, or Worker is involved.
    for (const item of items) {
      const persisted = await this.results.getWithContext(item.hash);
      if (!persisted) continue;
      const campaignId = persisted.comparisonContext.campaignId;
      // Unknown legacy analyses stay isolated: sharing no UUID is not evidence
      // that they belong to one campaign.
      const key = campaignId
        ? `campaign:${campaignId}`
        : `unknown:${item.hash}`;
      const group = groups.get(key) ?? {
        campaignId,
        playerCountryTags: new Set<string>(),
        snapshots: [],
      };
      if (persisted.comparisonContext.playerCountryTag) {
        group.playerCountryTags.add(
          persisted.comparisonContext.playerCountryTag,
        );
      }
      group.snapshots.push(
        snapshot(item, persisted.result, persisted.comparisonContext),
      );
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
  }

  async buildEquipment(
    campaignKey: string,
    countryTag: string,
  ): Promise<CampaignEquipmentTrendsDto> {
    const items = (await this.recent.list()).filter(
      (item) => item.hasPersistedResult,
    );
    const targetCampaignId = campaignKey.startsWith('campaign:')
      ? campaignKey.slice('campaign:'.length)
      : null;
    const targetUnknownHash = campaignKey.startsWith('unknown:')
      ? campaignKey.slice('unknown:'.length)
      : null;
    const snapshots: EquipmentSnapshot[] = [];

    // Read each candidate artifact once and project all three equipment metrics
    // in the same pass. Metadata lets known campaigns skip unrelated artifacts.
    for (const item of items) {
      if (targetUnknownHash && item.hash !== targetUnknownHash) continue;
      if (
        targetCampaignId &&
        item.campaignId &&
        item.campaignId !== targetCampaignId
      )
        continue;
      const persisted = await this.results.getWithContext(item.hash);
      if (!persisted) continue;
      const key = persisted.comparisonContext.campaignId
        ? `campaign:${persisted.comparisonContext.campaignId}`
        : `unknown:${item.hash}`;
      if (key !== campaignKey) continue;
      snapshots.push({ item, result: persisted.result });
    }
    snapshots.sort(compareEquipmentSnapshots);

    const projected = snapshots.map(({ result }) =>
      equipmentValuesByDefinition(result, countryTag),
    );
    const definitions = [
      ...new Set(projected.flatMap((entry) => [...entry.keys()])),
    ].sort((left, right) => left.localeCompare(right));

    return {
      campaignKey,
      countryTag,
      snapshotHashes: snapshots.map(({ item }) => item.hash),
      definitions: definitions.map((equipmentDefinition) => ({
        equipmentDefinition,
        stockpileBalance: projected.map(
          (entry) => entry.get(equipmentDefinition)?.stockpileBalance ?? null,
        ),
        activeFactories: projected.map(
          (entry) => entry.get(equipmentDefinition)?.activeFactories ?? null,
        ),
        currentItemsPerDay: projected.map(
          (entry) => entry.get(equipmentDefinition)?.currentItemsPerDay ?? null,
        ),
        productionRateComplete: projected.map(
          (entry) =>
            entry.get(equipmentDefinition)?.productionRateComplete ?? null,
        ),
      })),
    };
  }
}
