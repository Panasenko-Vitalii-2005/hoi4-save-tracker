import { useEffect, useState } from "react";
import type { AnalyzeResult } from "@/types";
import { AnalyzerTab } from "./AnalyzerTab";

const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAnalyzeResult(value: unknown): value is AnalyzeResult {
  if (!isObject(value) || typeof value.game_date !== "string") return false;
  if (
    !isObject(value.totals) ||
    !isObject(value.equipment_by_country) ||
    !isObject(value.world_equipment)
  )
    return false;
  return [
    "by_country",
    "stockpileSummaries",
    "militaryProductionSummaries",
    "divisionSummaries",
    "divisionTemplateCatalog",
    "divisionEquipmentCatalog",
    "armyHierarchySummaries",
    "navalLosses",
    "navalLossSummaries",
    "navalKills",
    "navalKillSummaries",
    "navalKillerShipSummaries",
  ].every((key) => Array.isArray(value[key]));
}

export function SharedAnalysisPage({ publicId }: { publicId: string }) {
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = result
      ? `HoI4 Save Analysis — ${result.game_date}`
      : "HoI4 Save Analysis";
    return () => {
      document.title = previousTitle;
    };
  }, [result]);

  useEffect(() => {
    if (!PUBLIC_ID.test(publicId)) {
      setResult(null);
      setLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setResult(null);
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(
          `/api/share/${encodeURIComponent(publicId)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Shared analysis unavailable");
        const data: unknown = await response.json();
        if (!isAnalyzeResult(data)) throw new Error("Invalid shared analysis");
        if (active) setResult(data);
      } catch {
        if (active) setResult(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [publicId, retry]);

  return (
    <main className="page-shell shared-analysis-page">
      <header className="hero shared-analysis-hero">
        <div className="hero-copy">
          <div className="eyebrow">Public read-only analysis</div>
          <h1>HoI4 Save Analysis</h1>
          <p>
            {result
              ? `Campaign snapshot · Save date ${result.game_date}`
              : "A shared Hearts of Iron IV campaign snapshot."}
          </p>
        </div>
      </header>

      {loading ? (
        <section className="panel shared-analysis-state" role="status">
          <span className="spinner" aria-hidden="true" /> Loading shared
          analysis…
        </section>
      ) : result ? (
        <AnalyzerTab readOnlyResult={result} />
      ) : (
        <section className="panel shared-analysis-state" role="alert">
          <h2>Shared analysis unavailable</h2>
          <p>
            This link may be invalid, revoked, unavailable because its stored
            result was removed, or temporarily inaccessible.
          </p>
          <button
            className="button button-secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        </section>
      )}
    </main>
  );
}
