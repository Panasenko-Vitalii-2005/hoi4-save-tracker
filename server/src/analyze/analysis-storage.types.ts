import type { RecentAnalysis } from './recent-analyses.service';

export interface AnalysisStorageCampaign {
  campaignId: string;
  playerCountryTag: string | null;
  analysisCount: number;
  persistedAnalysisCount: number;
  pinnedAnalysisCount: number;
  sharedAnalysisCount: number;
  resultBytes: number;
  firstGameDate: string | null;
  latestGameDate: string | null;
}

export interface AnalysisStorageStatus {
  recentAnalysisCount: number;
  persistedAnalysisCount: number;
  persistedResultBytes: number;
  maxPersistedResultBytes: number;
  knownCampaignCount: number;
  unknownCampaignAnalysisCount: number;
  pinnedAnalysisCount: number;
  unpinnedAnalysisCount: number;
  sharedAnalysisCount: number;
  cleanupEligibleCount: number;
  shareStatusReliable: boolean;
  campaigns: AnalysisStorageCampaign[];
}

export interface AnalysisStorageMutationResult {
  deletedCount: number;
  items: RecentAnalysis[];
  storage: AnalysisStorageStatus;
}
