import { Injectable } from '@nestjs/common';
import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import {
  type AnalysisOwnership,
  AnalysisOwnershipService,
} from './analysis-ownership.service';
import type {
  AnalysisStorageCampaign,
  AnalysisStorageStatus,
} from './analysis-storage.types';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import {
  normalizeCampaignId,
  PinnedCampaignAnalysesError,
  type RecentAnalysis,
  RecentAnalysesService,
} from './recent-analyses.service';
import { SharedAnalysesService } from './shared-analyses.service';

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

/** Builds the private, per-user view over globally deduplicated result storage. */
@Injectable()
export class UserAnalysesService {
  constructor(
    private readonly ownership: AnalysisOwnershipService,
    private readonly recent: RecentAnalysesService,
    private readonly results: PersistedAnalysisResultService,
    private readonly shares: SharedAnalysesService,
  ) {}

  async list(userId: string): Promise<RecentAnalysis[]> {
    const [metadata, ownerships] = await Promise.all([
      this.recent.list(),
      this.ownership.listForUser(userId),
    ]);
    return this.project(metadata, ownerships);
  }

  private project(
    metadata: readonly RecentAnalysis[],
    ownerships: readonly AnalysisOwnership[],
  ): RecentAnalysis[] {
    const byHash = new Map(metadata.map((item) => [item.hash, item]));
    return ownerships.flatMap((owned) => {
      const item = byHash.get(owned.analysisHash);
      if (!item) return [];
      return [
        {
          ...item,
          fileName: owned.fileName ?? 'Stored analysis',
          analyzedAt: owned.analyzedAt,
          pinned: owned.pinned,
        },
      ];
    });
  }

  async getResult(userId: string, hash: string): Promise<AnalyzeResult | null> {
    if (!(await this.ownership.hasOwnership(userId, hash))) return null;
    return this.results.get(hash);
  }

  async storageStatus(userId: string): Promise<AnalysisStorageStatus> {
    const [metadata, ownerships, storage, shareProtection] = await Promise.all([
      this.recent.list(),
      this.ownership.listForUser(userId),
      this.results.storageStatus(),
      this.shares.protection(),
    ]);
    const items = this.project(metadata, ownerships);
    const owned = new Set(ownerships.map((item) => item.analysisHash));
    const resultFiles = new Map(
      storage.files
        .filter((file) => owned.has(file.hash))
        .map((file) => [file.hash, file.bytes]),
    );
    const shared = new Set(
      shareProtection.references
        .filter((reference) => owned.has(reference.hash))
        .map((reference) => reference.hash),
    );
    const groups = new Map<string, RecentAnalysis[]>();
    for (const item of items) {
      if (!item.campaignId) continue;
      const group = groups.get(item.campaignId) ?? [];
      group.push(item);
      groups.set(item.campaignId, group);
    }
    const campaigns: AnalysisStorageCampaign[] = [...groups.entries()]
      .map(([campaignId, group]) => {
        const tags = new Set(
          group
            .map((item) => item.playerCountryTag)
            .filter((tag): tag is string => !!tag),
        );
        const dated = group
          .map((item) => item.gameDate)
          .filter((date) => gameDate(date))
          .sort(compareGameDates);
        return {
          campaignId,
          playerCountryTag: tags.size === 1 ? [...tags][0] : null,
          analysisCount: group.length,
          persistedAnalysisCount: group.filter((item) =>
            resultFiles.has(item.hash),
          ).length,
          pinnedAnalysisCount: group.filter((item) => item.pinned).length,
          sharedAnalysisCount: group.filter((item) => shared.has(item.hash))
            .length,
          resultBytes: group.reduce(
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
    const pinnedAnalysisCount = ownerships.filter((item) => item.pinned).length;
    return {
      storageAccounting: 'owned_logical_artifacts',
      storageLimitScope: 'global_physical_artifacts',
      recentAnalysisCount: items.length,
      persistedAnalysisCount: resultFiles.size,
      persistedResultBytes: [...resultFiles.values()].reduce(
        (total, bytes) => total + bytes,
        0,
      ),
      maxPersistedResultBytes: storage.maxBytes,
      knownCampaignCount: campaigns.length,
      unknownCampaignAnalysisCount:
        ownerships.length - items.filter((item) => !!item.campaignId).length,
      pinnedAnalysisCount,
      unpinnedAnalysisCount: ownerships.length - pinnedAnalysisCount,
      sharedAnalysisCount: ownerships.filter((item) =>
        shared.has(item.analysisHash),
      ).length,
      cleanupEligibleCount: ownerships.length - pinnedAnalysisCount,
      shareStatusReliable: shareProtection.reliable,
      campaigns,
    };
  }

  async setPinned(
    userId: string,
    hash: string,
    pinned: boolean,
  ): Promise<boolean> {
    const found = await this.ownership.setPinned(userId, hash, pinned);
    if (found) await this.syncGlobalPins([hash]);
    return found;
  }

  async delete(userId: string, hash: string): Promise<boolean> {
    return (await this.remove(userId, [hash])).length === 1;
  }

  async clear(userId: string): Promise<string[]> {
    return this.remove(
      userId,
      (await this.ownership.listForUser(userId)).map(
        (item) => item.analysisHash,
      ),
    );
  }

  async deleteCampaign(
    userId: string,
    campaignId: string,
    includePinned: boolean,
  ): Promise<string[]> {
    const key = normalizeCampaignId(campaignId);
    if (!key) throw new TypeError('Invalid campaign id');
    const targets = (await this.list(userId)).filter(
      (item) => item.campaignId === key,
    );
    const pinnedCount = targets.filter((item) => item.pinned).length;
    if (pinnedCount > 0 && !includePinned)
      throw new PinnedCampaignAnalysesError(pinnedCount);
    return this.remove(
      userId,
      targets.map((item) => item.hash),
    );
  }

  async deleteUnpinned(userId: string): Promise<string[]> {
    return this.remove(
      userId,
      (await this.ownership.listForUser(userId))
        .filter((item) => !item.pinned)
        .map((item) => item.analysisHash),
    );
  }

  private async remove(
    userId: string,
    hashes: readonly string[],
  ): Promise<string[]> {
    const removed = await this.ownership.remove(userId, hashes);
    await this.syncGlobalPins(removed);
    // Ownership deletion intentionally does not delete a globally deduplicated
    // blob. Existing retention/share reconciliation remains its lifecycle owner.
    return removed;
  }

  private async syncGlobalPins(hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return;
    const pinned = await this.ownership.pinnedHashes(hashes);
    await this.recent.setPinnedStates(
      new Map(hashes.map((hash) => [hash, pinned.has(hash)])),
    );
  }
}
