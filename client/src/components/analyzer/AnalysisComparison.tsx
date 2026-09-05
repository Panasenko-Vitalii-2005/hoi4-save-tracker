import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecentAnalysis } from "@/types";
import type { AnalysisComparisonDto } from "@/types/analysis-comparison";
import { ANALYZER_UNAVAILABLE_MESSAGE } from "@/lib/analysis-error";
import { AnalysisComparisonResults } from "./AnalysisComparisonResults";
import { ComparisonReport } from "@/components/reports/ComparisonReport";
import { apiFetch } from "@/lib/api-client";

function compareGameDates(
  baseDate: string,
  targetDate: string,
): "after" | "same" | "before" | "unknown" {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})$/.exec(value);
    if (!match) return null;
    const parts = match.slice(1).map(Number);
    return parts[0] > 0 &&
      parts[1] >= 1 &&
      parts[1] <= 12 &&
      parts[2] >= 1 &&
      parts[2] <= 31
      ? parts
      : null;
  };
  const base = parse(baseDate);
  const target = parse(targetDate);
  if (!base || !target) return "unknown";
  for (let index = 0; index < base.length; index++) {
    if (target[index] > base[index]) return "after";
    if (target[index] < base[index]) return "before";
  }
  return "same";
}

export function AnalysisComparison({
  items,
  busy,
  onUnavailable,
  optionsLoading = false,
  optionsUnavailable = false,
  onRetryOptions,
  onAnalyzeSave,
}: {
  items: RecentAnalysis[];
  busy: boolean;
  onUnavailable: () => void;
  optionsLoading?: boolean;
  optionsUnavailable?: boolean;
  onRetryOptions?: () => void;
  onAnalyzeSave?: () => void;
}) {
  const [baseHash, setBaseHash] = useState("");
  const [targetHash, setTargetHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [completed, setCompleted] = useState<{
    data: AnalysisComparisonDto;
    baseName: string;
    targetName: string;
  } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const available = useMemo(
    () => items.filter((item) => item.hasPersistedResult === true),
    [items],
  );

  const base = available.find((item) => item.hash === baseHash);
  const target = available.find((item) => item.hash === targetHash);
  const selectedChronology =
    base && target ? compareGameDates(base.gameDate, target.gameDate) : null;
  const completedMatchesSelection =
    completed?.data.baseHash === baseHash &&
    completed?.data.targetHash === targetHash;
  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setLoading(false);
  }, []);

  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  useEffect(() => {
    if ((baseHash && !base) || (targetHash && !target)) {
      cancel();
      if (!base) setBaseHash("");
      if (!target) setTargetHash("");
      setError(
        "A selected result is no longer available. Choose another analysis.",
      );
      setErrorRetryable(false);
    }
  }, [baseHash, targetHash, base, target, cancel]);

  const select = (side: "base" | "target", hash: string) => {
    cancel();
    setError("");
    setErrorRetryable(false);
    if (side === "base") setBaseHash(hash);
    else setTargetHash(hash);
  };
  const compare = async () => {
    if (pending.current || busy || !base || !target) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    setErrorRetryable(false);
    let reachedService = false;
    try {
      const query = new URLSearchParams({
        base: base.hash,
        target: target.hash,
      });
      const response = await apiFetch(`/api/analyze/compare?${query}`, {
        signal: controller.signal,
      });
      reachedService = true;
      if (pending.current !== controller) return;
      if (response.status === 404 || response.status === 410) {
        setError(
          "One or both saved results are no longer available. Refreshing recent analyses…",
        );
        setErrorRetryable(false);
        onUnavailable();
        return;
      }
      if (!response.ok) throw new Error("Comparison unavailable");
      const data = (await response.json()) as AnalysisComparisonDto;
      if (pending.current !== controller) return;
      if (
        data.baseHash !== base.hash ||
        data.targetHash !== target.hash ||
        !Array.isArray(data.countries) ||
        !Array.isArray(data.equipmentProduction) ||
        !data.summary ||
        !data.context
      )
        throw new Error("Invalid comparison response");
      setCompleted({
        data,
        baseName: base.fileName,
        targetName: target.fileName,
      });
      setReportOpen(false);
    } catch {
      if (pending.current === controller) {
        setError(
          reachedService
            ? "Could not compare saved analyses. The saved results are unchanged. Try again."
            : ANALYZER_UNAVAILABLE_MESSAGE,
        );
        setErrorRetryable(true);
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  };

  if (available.length < 2) {
    if (optionsUnavailable) {
      return (
        <section
          className="panel analysis-comparison-controls analysis-comparison-empty"
          aria-label="Compare saves"
        >
          <div>
            <span className="eyebrow">Saved analysis comparison</span>
            <h2>Comparison options unavailable</h2>
            <p>
              Recent analyses could not be loaded. Existing saved data has not
              been changed.
            </p>
          </div>
          {onRetryOptions && (
            <button
              className="button button-secondary"
              onClick={onRetryOptions}
            >
              Try again
            </button>
          )}
        </section>
      );
    }
    if (optionsLoading) {
      return (
        <section
          className="panel analysis-comparison-controls analysis-comparison-empty"
          aria-label="Compare saves"
          aria-busy="true"
        >
          <div>
            <span className="eyebrow">Saved analysis comparison</span>
            <h2>Loading comparison options…</h2>
            <p>Reading saved analyses.</p>
          </div>
        </section>
      );
    }
    const noneAvailable = available.length === 0;
    return (
      <section
        className="panel analysis-comparison-controls analysis-comparison-empty"
        aria-label="Compare saves"
      >
        <div>
          <span className="eyebrow">Saved analysis comparison</span>
          <h2>Compare Saves</h2>
          <p>
            {noneAvailable
              ? "Analyze at least two saves before comparing campaign snapshots."
              : "One saved analysis is ready. Analyze one more save to compare changes."}
          </p>
        </div>
        {onAnalyzeSave && (
          <button className="button button-primary" onClick={onAnalyzeSave}>
            {noneAvailable ? "Analyze Save" : "Analyze Another Save"}
          </button>
        )}
      </section>
    );
  }

  if (
    completed &&
    reportOpen &&
    available.some(({ hash }) => hash === completed.data.baseHash) &&
    available.some(({ hash }) => hash === completed.data.targetHash)
  )
    return (
      <ComparisonReport
        data={completed.data}
        baseName={completed.baseName}
        targetName={completed.targetName}
        selectedCountryTag={
          completed.data.countries.find(({ hasChanges }) => hasChanges)?.tag ??
          completed.data.countries[0]?.tag ??
          null
        }
        onBack={() => setReportOpen(false)}
      />
    );

  return (
    <>
      <section
        className="panel analysis-comparison-controls"
        aria-label="Compare saves"
        aria-busy={loading}
      >
        <div className="comparison-control-layout">
          <div className="comparison-control-copy">
            <span className="eyebrow">Saved analysis comparison</span>
            <h2>Compare Saves</h2>
            <p className="comparison-subtitle">
              Compare two saved world snapshots.
              <span>
                All values show the difference <strong>Target − Base</strong>.
              </span>
            </p>
          </div>
          <div className="comparison-picker-region">
            <div className="comparison-save-picker">
              {(["base", "target"] as const).map((side) => {
                const selected = side === "base" ? base : target;
                return (
                  <label
                    className="comparison-save-card"
                    key={side}
                    htmlFor={`compare-${side}`}
                  >
                    <span className="comparison-save-role">
                      {side === "base" ? "Base" : "Target"}
                    </span>
                    <select
                      id={`compare-${side}`}
                      value={selected?.hash ?? ""}
                      onChange={(e) => select(side, e.target.value)}
                    >
                      <option value="">Select an analysis</option>
                      {available.map((item) => (
                        <option key={item.hash} value={item.hash}>
                          {item.fileName}
                        </option>
                      ))}
                    </select>
                    <span className="comparison-save-date">
                      {selected?.gameDate || "No save selected"}
                    </span>
                  </label>
                );
              })}
              <button
                className="button button-secondary comparison-swap"
                aria-label="Swap base and target analyses"
                title="Swap Base and Target"
                disabled={!base || !target}
                onClick={() => {
                  cancel();
                  setError("");
                  setErrorRetryable(false);
                  setBaseHash(targetHash);
                  setTargetHash(baseHash);
                }}
              >
                <span aria-hidden="true">⇄</span>
                <span className="comparison-swap-label">Swap</span>
              </button>
            </div>
            <div className="comparison-actions">
              <button
                className="button button-primary"
                disabled={!base || !target || busy || loading}
                onClick={() => void compare()}
              >
                {loading ? "Comparing…" : "Compare"}
              </button>
            </div>
          </div>
        </div>
        <p className="micro-copy" role="status" aria-live="polite">
          {loading ? "Loading saved analyses for comparison…" : ""}
        </p>
        {error && (
          <div className="recovery-notice" role="alert">
            <span>{error}</span>
            {errorRetryable && (
              <button
                className="button button-secondary"
                onClick={() => void compare()}
                disabled={loading || busy || !base || !target}
              >
                Try again
              </button>
            )}
          </div>
        )}
        {base && target && !completedMatchesSelection && (
          <div
            className="comparison-context comparison-selection-context"
            aria-label="Selected comparison context"
          >
            {base.hash === target.hash ? (
              <p className="comparison-context-note">
                Base and Target are the same saved analysis.
              </p>
            ) : selectedChronology === "same" ? (
              <p className="comparison-context-note">
                Base and Target have the same game date.
              </p>
            ) : null}
            {selectedChronology === "before" && (
              <p className="comparison-context-warning" role="status">
                Target save is earlier than Base save. Changes are still
                calculated as Target − Base.
              </p>
            )}
          </div>
        )}
        {completed &&
          !completedMatchesSelection && (
            <p className="micro-copy">
              Showing the last completed comparison below. Press Compare to
              update it.
            </p>
          )}
      </section>
      {completed && (
        <AnalysisComparisonResults
          {...completed}
          showContext={completedMatchesSelection}
          onViewReport={() => setReportOpen(true)}
        />
      )}
    </>
  );
}
