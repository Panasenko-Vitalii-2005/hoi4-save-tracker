import { useEffect, useState } from "react";
import type { AnalyzeResult } from "@/types";
import { isAnalyzeResult } from "@/lib/analyze-result";
import { ANALYZER_UNAVAILABLE_MESSAGE } from "@/lib/analysis-error";
import { apiFetch } from "@/lib/api-client";
import { sharedAnalysisTelemetryHeaders } from "@/lib/product-telemetry";
import { AnalyzerTab } from "./AnalyzerTab";

const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

export function SharedAnalysisPage({ publicId }: { publicId: string }) {
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
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
      setFailure("This shared-analysis link is invalid.");
      setLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setResult(null);
    setFailure("");
    setLoading(true);
    void (async () => {
      try {
        const response = await apiFetch(
          `/api/share/${encodeURIComponent(publicId)}`,
          {
            signal: controller.signal,
            headers: sharedAnalysisTelemetryHeaders(),
          },
          "public",
        );
        if (response.status === 404 || response.status === 410) {
          if (active)
            setFailure(
              "This link is invalid, revoked, or its saved result is no longer available.",
            );
          return;
        }
        if (!response.ok) {
          if (active)
            setFailure(
              "The shared analysis is temporarily unavailable. Try again.",
            );
          return;
        }
        const data: unknown = await response.json().catch(() => null);
        if (!isAnalyzeResult(data)) {
          if (active)
            setFailure(
              "This shared analysis cannot be read. Ask its owner to create a new share link.",
            );
          return;
        }
        if (active) {
          setResult(data);
          setFailure("");
        }
      } catch {
        if (active) {
          setResult(null);
          setFailure(ANALYZER_UNAVAILABLE_MESSAGE);
        }
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
          <p>{failure}</p>
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
