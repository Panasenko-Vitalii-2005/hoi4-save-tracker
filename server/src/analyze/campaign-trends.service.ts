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
  left: CampaignTrendSnapshot,
  right: CampaignTrendSnapshot,
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
}
