import type { AnalyzeResult } from '../hoi4/hoi4-parser';
import {
  normalizeSaveComparisonContext,
  type SaveComparisonContext,
} from '../hoi4/save-comparison-context';
import type { PersistedResultFingerprint } from './persisted-analysis-result.service';
import {
  readHistorySummary,
  type AnalysisHistorySummary,
} from './recent-analysis-metadata';

export type OwnedHistorySummary = AnalysisHistorySummary;

export interface OwnedHistoryMetadata {
  version: 1;
  summary: OwnedHistorySummary;
  fingerprint: PersistedResultFingerprint;
}

export function historySummary(item: OwnedHistorySummary): OwnedHistorySummary {
  return {
    fileSizeBytes: item.fileSizeBytes,
    gameDate: item.gameDate,
    countryCount: item.countryCount,
    divisionCount: item.divisionCount,
    shipCount: item.shipCount,
    navalLossCount: item.navalLossCount,
    manpowerInField: item.manpowerInField,
    aircraftCount: item.aircraftCount,
    ...(item.campaignId !== undefined ? { campaignId: item.campaignId } : {}),
    ...(item.playerCountryTag !== undefined
      ? { playerCountryTag: item.playerCountryTag }
      : {}),
  };
}

export function summaryFromResult(
  result: AnalyzeResult,
  fileSizeBytes: number | null,
  comparisonContext: SaveComparisonContext,
): OwnedHistorySummary | null {
  const context = normalizeSaveComparisonContext(comparisonContext);
  try {
    return readHistorySummary({
      fileSizeBytes,
      gameDate: result.game_date,
      countryCount: result.active_countries,
      divisionCount: result.totals.divisions,
      shipCount: result.totals.ships,
      navalLossCount: result.navalLosses.length,
      manpowerInField: result.totals.manpowerInField,
      aircraftCount: result.totals.aircraft,
      campaignId: context?.campaignId ?? null,
      playerCountryTag: context?.playerCountryTag ?? null,
    });
  } catch {
    // A readable envelope can still lack valid summary fields. Never manufacture
    // counts or let one incompatible artifact prevent discovery of other history.
    return null;
  }
}

export function sameFingerprint(
  a: PersistedResultFingerprint,
  b: PersistedResultFingerprint,
): boolean {
  return (
    a.bytes === b.bytes && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
  );
}

/** Whitelist persisted JSON again on read; never expose arbitrary database properties. */
export function readOwnedHistory(value: unknown): OwnedHistoryMetadata | null {
  try {
    if (!value || typeof value !== 'object') return null;
    const data = value as OwnedHistoryMetadata;
    if (data.version !== 1 || !data.fingerprint || !data.summary) return null;
    const { bytes, mtimeMs, ctimeMs } = data.fingerprint;
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      !Number.isFinite(mtimeMs) ||
      !Number.isFinite(ctimeMs)
    )
      return null;
    return {
      version: 1,
      summary: readHistorySummary(data.summary),
      fingerprint: { bytes, mtimeMs, ctimeMs },
    };
  } catch {
    return null;
  }
}
