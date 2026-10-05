import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CampaignTrendsService,
  compareDates,
  gameDate,
} from '../campaign-trends.service';
import type { CampaignSnapshotProjection } from '../campaign-snapshot-projection-cache.service';
import { UserAnalysesService } from '../user-analyses.service';
import { generateIntelligence } from './intelligence.engine';
import { textOrder } from './observations';
import type {
  CampaignIntelligenceDto,
  CoverageIssue,
  IntelligenceQuery,
  TimeWindow,
} from './intelligence.types';

/** Stricter validation for temporal inference, without altering existing Trends dates. */
export function intelligenceDate(value: unknown) {
  const parts = gameDate(value);
  if (!parts || !parts.every(Number.isSafeInteger)) return null;
  const [year, month, day] = parts;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1] ? parts : null;
}

@Injectable()
export class CampaignIntelligenceService {
  constructor(
    private readonly trends: CampaignTrendsService,
    private readonly users: UserAnalysesService,
  ) {}

  async build(
    userId: string,
    query: IntelligenceQuery,
  ): Promise<CampaignIntelligenceDto> {
    return this.trends.withAuthorizedProjections(
      () => this.users.list(userId),
      (_items, loaded) => {
        const base = loaded.get(query.baseHash);
        const target = loaded.get(query.targetHash);
        const campaignId = query.campaignKey.startsWith('campaign:')
          ? query.campaignKey.slice(9)
          : null;
        // Generic error for unauthorized, deleted, unreadable or wrong-campaign endpoints.
        if (
          !base ||
          !target ||
          !campaignId ||
          base.campaignId !== campaignId ||
          target.campaignId !== campaignId
        )
          throw new NotFoundException('Campaign snapshots are unavailable');
        const baseDate = intelligenceDate(base.gameDate);
        const targetDate = intelligenceDate(target.gameDate);
        const reasons: string[] = [];
        const issues: CoverageIssue[] = [
          { code: 'available_authorized_history_only' },
          { code: 'campaign_branch_continuity_not_verified' },
        ];
        if (!baseDate || !targetDate) reasons.push('invalid_game_date');
        else if (compareDates(baseDate, targetDate) === 0)
          reasons.push('same_date_chronology_unknown');
        else if (compareDates(baseDate, targetDate) > 0)
          reasons.push('reversed_temporal_window');
        const intermediate: CampaignSnapshotProjection[] = [];
        if (baseDate && targetDate && compareDates(baseDate, targetDate) < 0)
          for (const projection of loaded.values()) {
            if (
              projection.campaignId !== campaignId ||
              projection.hash === base.hash ||
              projection.hash === target.hash
            )
              continue;
            const date = intelligenceDate(projection.gameDate);
            if (!date) {
              issues.push({
                code: 'unplaced_invalid_game_date',
                snapshotHash: projection.hash,
              });
              continue;
            }
            // Other saves on endpoint dates cannot be placed before/after the selected save.
            if (
              compareDates(date, baseDate) > 0 &&
              compareDates(date, targetDate) < 0
            )
              intermediate.push(projection);
          }
        intermediate.sort(
          (a, b) =>
            compareDates(
              intelligenceDate(a.gameDate)!,
              intelligenceDate(b.gameDate)!,
            ) || textOrder(a.hash, b.hash),
        );
        const snapshots =
          base.hash === target.hash ? [base] : [base, ...intermediate, target];
        const dates = intermediate.map((snapshot) =>
          JSON.stringify(intelligenceDate(snapshot.gameDate)),
        );
        if (new Set(dates).size !== dates.length)
          issues.push({ code: 'same_date_intermediate_order_unknown' });
        const versions = new Set(
          snapshots
            .map((snapshot) => snapshot.gameVersion)
            .filter((value) => value !== null),
        );
        if (versions.size > 1) reasons.push('game_version_mismatch');
        for (const snapshot of snapshots)
          if (snapshot.gameVersion === null)
            issues.push({
              code: 'unknown_game_version',
              snapshotHash: snapshot.hash,
            });
        const window: TimeWindow = {
          ...query,
          baseGameDate: base.gameDate,
          targetGameDate: target.gameDate,
          snapshotHashes: snapshots.map((snapshot) => snapshot.hash),
          selectionBasis:
            'explicit_endpoints_and_strictly_intermediate_game_dates',
          temporalEligible: reasons.length === 0,
          suppressionReasons: reasons,
        };
        return generateIntelligence(snapshots, window, issues);
      },
    );
  }
}
