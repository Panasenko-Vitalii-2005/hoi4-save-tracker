import { useEffect, useState } from "react";
import type { AnalyzeResult } from "@/types";
import { isAnalyzeResult } from "@/lib/analyze-result";
import { analyzerUnavailableMessage } from "@/lib/analysis-error";
import { apiFetch } from "@/lib/api-client";
import { sharedAnalysisTelemetryHeaders } from "@/lib/product-telemetry";
import { AnalyzerTab } from "./AnalyzerTab";
import { useAppTranslation } from "@/i18n";

const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

export function SharedAnalysisPage({ publicId }: { publicId: string }) {
  const { t } = useAppTranslation();
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = result
      ? `HoI4 Save Analysis — ${result.game_date}`
      : t("share.pageTitle");
    return () => {
      document.title = previousTitle;
    };
  }, [result, t]);

  useEffect(() => {
    if (!PUBLIC_ID.test(publicId)) {
      setResult(null);
      setFailure(t("share.invalid"));
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
              t("share.invalidOrRevoked"),
            );
          return;
        }
        if (!response.ok) {
          if (active)
            setFailure(
              t("share.temporarilyUnavailable"),
            );
          return;
        }
        const data: unknown = await response.json().catch(() => null);
        if (!isAnalyzeResult(data)) {
          if (active)
            setFailure(
              t("share.unreadable"),
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
          setFailure(analyzerUnavailableMessage());
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [publicId, retry, t]);

  return (
    <main className="page-shell shared-analysis-page">
      <header className="hero shared-analysis-hero">
        <div className="hero-copy">
          <div className="eyebrow">{t("share.publicReadOnly")}</div>
          <h1>{t("share.pageTitle")}</h1>
          <p>
            {result
              ? t("share.snapshot", { date: result.game_date })
              : t("share.snapshotFallback")}
          </p>
        </div>
      </header>

      {loading ? (
        <section className="panel shared-analysis-state" role="status">
          <span className="spinner" aria-hidden="true" /> {t("share.loading")}
        </section>
      ) : result ? (
        <AnalyzerTab readOnlyResult={result} />
      ) : (
        <section className="panel shared-analysis-state" role="alert">
          <h2>{t("share.unavailableTitle")}</h2>
          <p>{failure}</p>
          <button
            className="button button-secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("common.retry")}
          </button>
        </section>
      )}
    </main>
  );
}
