import { basename, win32 } from 'node:path';

export interface RecentAnalysis {
  hash: string;
  fileName: string;
  fileSizeBytes: number | null;
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

const CAMPAIGN_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function normalizeCampaignId(value: string): string | null {
  return CAMPAIGN_ID.test(value) ? value.toLowerCase() : null;
}

function safeFileName(name: string): string {
  return win32.basename(basename(name)) || 'Unnamed save';
}

export type AnalysisHistorySummary = Pick<
  RecentAnalysis,
  | 'fileSizeBytes'
  | 'gameDate'
  | 'countryCount'
  | 'divisionCount'
  | 'shipCount'
  | 'navalLossCount'
  | 'manpowerInField'
  | 'aircraftCount'
  | 'campaignId'
  | 'playerCountryTag'
>;

// Reconstruct the whitelist on every load; arbitrary disk/DB fields never escape.
export function readHistorySummary(value: unknown): AnalysisHistorySummary {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid history summary');
  const item = value as Record<string, unknown>;
  const count = (key: string): number => {
    const value = item[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid history count');
    return value;
  };
  const optionalCount = (key: string): number | null =>
    item[key] == null ? null : count(key);
  if (typeof item.gameDate !== 'string')
    throw new Error('Invalid history date');
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
    fileSizeBytes: optionalCount('fileSizeBytes'),
    gameDate: item.gameDate,
    countryCount: count('countryCount'),
    divisionCount: count('divisionCount'),
    shipCount: count('shipCount'),
    navalLossCount: count('navalLossCount'),
    manpowerInField: optionalCount('manpowerInField'),
    aircraftCount: optionalCount('aircraftCount'),
    ...(hasCampaignId ? { campaignId } : {}),
    ...(hasPlayerCountryTag ? { playerCountryTag } : {}),
  };
}

export function readRecentAnalysis(value: unknown): RecentAnalysis {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid history item');
  const item = value as Record<string, unknown>;
  if (
    typeof item.hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.hash) ||
    typeof item.fileName !== 'string' ||
    typeof item.analyzedAt !== 'string' ||
    !Number.isFinite(Date.parse(item.analyzedAt))
  )
    throw new Error('Invalid history metadata');
  return {
    ...readHistorySummary(item),
    hash: item.hash,
    fileName: safeFileName(item.fileName),
    analyzedAt: new Date(item.analyzedAt).toISOString(),
    hasPersistedResult: item.hasPersistedResult === true,
    pinned: item.pinned === true,
  };
}
