import { Injectable } from '@nestjs/common';
import { AnalysisOwnershipService } from '../analyze/analysis-ownership.service';
import { PersistedAnalysisResultService } from '../analyze/persisted-analysis-result.service';
import { sameFingerprint } from '../analyze/owned-analysis-history';
import {
  CampaignSnapshotProjectionCacheService,
  type CampaignSnapshotProjection,
} from '../analyze/campaign-snapshot-projection-cache.service';
import { intelligenceDate } from '../analyze/intelligence/campaign-intelligence.service';
import { compareDates } from '../analyze/campaign-trends.service';

export type ReviewSnapshotIdentity = Pick<
  CampaignSnapshotProjection,
  'hash' | 'gameDate' | 'campaignId' | 'gameVersion'
>;

/** Eligibility for measurement only. Does not change Compare/Trends/Intelligence
 * behavior. Unknown version is not proof of a conflict; unknown campaign is. */
export function suitableReviewPair(
  base: ReviewSnapshotIdentity,
  target: ReviewSnapshotIdentity,
): boolean {
  const a = intelligenceDate(base.gameDate),
    b = intelligenceDate(target.gameDate);
  return (
    base.hash !== target.hash &&
    !!base.campaignId &&
    base.campaignId === target.campaignId &&
    !!a &&
    !!b &&
    compareDates(a, b) < 0 &&
    !(
      base.gameVersion !== null &&
      target.gameVersion !== null &&
      base.gameVersion !== target.gameVersion
    )
  );
}

@Injectable()
export class CampaignReviewService {
  constructor(
    private readonly ownership: AnalysisOwnershipService,
    private readonly results: PersistedAnalysisResultService,
    private readonly projections: CampaignSnapshotProjectionCacheService,
  ) {}

  async eligible(
    userId: string,
    baseHash: string,
    targetHash: string,
  ): Promise<boolean> {
    if (
      baseHash === targetHash ||
      !(await this.ownership.hasAllOwnership(userId, [baseHash, targetHash]))
    )
      return false;
    const a = await this.results.fingerprint(baseHash),
      b = await this.results.fingerprint(targetHash);
    if (!a || !b) return false;
    const base = await this.projections.ensure(baseHash, a),
      target = await this.projections.ensure(targetHash, b);
    if (!base || !target || !suitableReviewPair(base, target)) return false;
    const afterA = await this.results.fingerprint(baseHash),
      afterB = await this.results.fingerprint(targetHash);
    return (
      !!afterA &&
      !!afterB &&
      sameFingerprint(a, afterA) &&
      sameFingerprint(b, afterB) &&
      (await this.ownership.hasAllOwnership(userId, [baseHash, targetHash]))
    );
  }
}
