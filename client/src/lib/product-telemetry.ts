import { apiFetch } from "@/lib/api-client";
import type { CampaignTrendSnapshot } from "@/types/campaign-trends";
import { intelligenceDay } from "@/lib/campaign-intelligence";

export const ANALYSIS_SECTIONS = [
  "overview",
  "war-casualties",
  "naval-losses",
  "stockpile",
  "production",
  "land-forces",
] as const;

export type AnalysisSection = (typeof ANALYSIS_SECTIONS)[number];
export type ClientProductEventName =
  "analysis_opened" | "analysis_section_viewed" | "analysis_shared";

const SESSION_KEY = "hoi4:product-telemetry:session:v1";
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANALYSIS_HASH = /^[0-9a-f]{64}$/i;
const SECTION_SET = new Set<string>(ANALYSIS_SECTIONS);

function clientSessionId(): string | null {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && SESSION_ID.test(existing)) return existing;
    if (typeof crypto.randomUUID !== "function") return null;
    const created = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return null;
  }
}

function dedupe(
  clientSessionId: string,
  eventName: ClientProductEventName,
  analysisHash: string,
  section?: AnalysisSection,
): boolean {
  try {
    const key = [
      "hoi4:product-telemetry:event:v1",
      clientSessionId,
      eventName,
      analysisHash.toLowerCase(),
      section ?? "-",
    ].join(":");
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

export async function trackAnalysisEvent(
  eventName: ClientProductEventName,
  analysisHash: string,
  section?: AnalysisSection,
): Promise<void> {
  const sessionId = clientSessionId();
  if (
    !sessionId ||
    !ANALYSIS_HASH.test(analysisHash) ||
    (eventName === "analysis_section_viewed"
      ? !section || !SECTION_SET.has(section)
      : section !== undefined)
  )
    return;
  const normalizedHash = analysisHash.toLowerCase();
  if (!dedupe(sessionId, eventName, normalizedHash, section)) return;
  try {
    await apiFetch("/api/product-events/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName,
        analysisHash: normalizedHash,
        clientSessionId: sessionId,
        ...(section ? { section } : {}),
      }),
    });
  } catch {
    // Product telemetry is best effort and must never interrupt the workflow.
  }
}

export function sharedAnalysisTelemetryHeaders(): HeadersInit | undefined {
  const sessionId = clientSessionId();
  return sessionId ? { "X-Product-Session": sessionId } : undefined;
}

export type CampaignReviewKind = "compare" | "trends" | "intelligence";

/** Pair comes from actually displayed data, never from a tab click. Same-date
 * snapshots have no established chronology. No filenames/country values sent. */
export function reviewEndpoints(
  snapshots: readonly CampaignTrendSnapshot[],
): { baseHash: string; targetHash: string } | null {
  const valid = snapshots
    .filter(
      (s) => ANALYSIS_HASH.test(s.hash) && intelligenceDay(s.gameDate) !== null,
    )
    .toSorted(
      (a, b) =>
        intelligenceDay(a.gameDate)! - intelligenceDay(b.gameDate)! ||
        a.hash.localeCompare(b.hash),
    );
  const base = valid[0],
    target = valid.at(-1);
  const versions = new Set(
    valid.map((s) => s.gameVersion).filter((v) => v !== null),
  );
  return base &&
    target &&
    base.hash !== target.hash &&
    intelligenceDay(base.gameDate)! < intelligenceDay(target.gameDate)! &&
    versions.size <= 1
    ? { baseHash: base.hash, targetHash: target.hash }
    : null;
}

export async function trackCampaignReview(
  viewKind: CampaignReviewKind,
  baseHash: string,
  targetHash: string,
): Promise<void> {
  const sessionId = clientSessionId();
  if (
    !sessionId ||
    !["compare", "trends", "intelligence"].includes(viewKind) ||
    !ANALYSIS_HASH.test(baseHash) ||
    !ANALYSIS_HASH.test(targetHash) ||
    baseHash.toLowerCase() === targetHash.toLowerCase()
  )
    return;
  const base = baseHash.toLowerCase(),
    target = targetHash.toLowerCase();
  try {
    // Daily scope permits a genuine later-day review in a tab left open. Server
    // uses server UTC day and authenticated user for its independent dedup key.
    const key = [
      "hoi4:product-telemetry:review:v1",
      sessionId,
      new Date().toISOString().slice(0, 10),
      viewKind,
      base,
      target,
    ].join(":");
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    await apiFetch("/api/product-events/campaign-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventName: "campaign_review_opened",
        baseHash: base,
        targetHash: target,
        clientSessionId: sessionId,
        viewKind,
      }),
    });
  } catch {
    /* Best effort; never interrupt a review. */
  }
}
