import { apiFetch } from "@/lib/api-client";

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
