import { readDirectScalar } from './naval-loss/global-history.parser';

export interface SaveComparisonContext {
  campaignId: string | null;
  gameVersion: string | null;
}

const CONTEXT_PREFIX_BYTES = 64 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function unknownSaveComparisonContext(): SaveComparisonContext {
  return { campaignId: null, gameVersion: null };
}

function campaignId(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

function gameVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized &&
    normalized.length <= 256 &&
    !Array.from(normalized).some((character) => character.charCodeAt(0) < 32)
    ? normalized
    : null;
}

/** Read immutable comparison context from the decoded save while it is in memory. */
export function parseSaveComparisonContext(
  saveText: string,
): SaveComparisonContext {
  const end = Math.min(saveText.length, CONTEXT_PREFIX_BYTES);
  return {
    campaignId: campaignId(
      readDirectScalar(saveText, 0, end, 'game_unique_id'),
    ),
    gameVersion: gameVersion(readDirectScalar(saveText, 0, end, 'version')),
  };
}

/** Strict persisted/Worker boundary validation. */
export function normalizeSaveComparisonContext(
  value: unknown,
): SaveComparisonContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const normalizedCampaignId =
    record.campaignId == null ? null : campaignId(record.campaignId);
  const normalizedGameVersion =
    record.gameVersion == null ? null : gameVersion(record.gameVersion);
  if (
    (record.campaignId != null && normalizedCampaignId === null) ||
    (record.gameVersion != null && normalizedGameVersion === null)
  ) {
    return null;
  }
  return {
    campaignId: normalizedCampaignId,
    gameVersion: normalizedGameVersion,
  };
}
