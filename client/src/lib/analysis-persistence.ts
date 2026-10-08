export type AnalysisPersistence = "saved" | "temporary" | "unknown";

/** A hash alone from an older server is not evidence of a durable owned result. */
export function readAnalysisPersistence(headers: Headers): {
  outcome: AnalysisPersistence;
  savedHash: string | null;
} {
  const outcome = headers.get("X-Analysis-Persistence");
  const hash = headers.get("X-Analysis-Hash");
  if (outcome === "saved" && hash && /^[0-9a-f]{64}$/i.test(hash))
    return { outcome: "saved", savedHash: hash.toLowerCase() };
  return {
    outcome: outcome === "temporary" ? "temporary" : "unknown",
    savedHash: null,
  };
}
