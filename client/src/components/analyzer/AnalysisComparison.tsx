import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecentAnalysis } from "@/types";
import type { AnalysisComparisonDto } from "@/types/analysis-comparison";
import { AnalysisComparisonResults } from "./AnalysisComparisonResults";

export function AnalysisComparison({
  items,
  busy,
  onUnavailable,
}: {
  items: RecentAnalysis[];
  busy: boolean;
  onUnavailable: () => void;
}) {
  const [baseHash, setBaseHash] = useState("");
  const [targetHash, setTargetHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<{
    data: AnalysisComparisonDto;
    baseName: string;
    targetName: string;
  } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const available = useMemo(
    () => items.filter((item) => item.hasPersistedResult === true),
    [items],
  );
  const base = available.find((item) => item.hash === baseHash);
  const target = available.find((item) => item.hash === targetHash);
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
    }
  }, [baseHash, targetHash, base, target, cancel]);

  const select = (side: "base" | "target", hash: string) => {
    cancel();
    setError("");
    if (side === "base") setBaseHash(hash);
    else setTargetHash(hash);
  };
  const compare = async () => {
    if (pending.current || busy || !base || !target) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        base: base.hash,
        target: target.hash,
      });
      const response = await fetch(`/api/analyze/compare?${query}`, {
        signal: controller.signal,
      });
      if (pending.current !== controller) return;
      if (response.status === 404 || response.status === 410) {
        setError(
          "One or both saved results are no longer available. Refreshing recent analyses…",
        );
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
        !data.summary
      )
        throw new Error("Invalid comparison response");
      setCompleted({
        data,
        baseName: base.fileName,
        targetName: target.fileName,
      });
    } catch {
      if (pending.current === controller)
        setError("Could not compare saved analyses. Please try again.");
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <>
      <section
        className="panel analysis-comparison-controls"
        aria-label="Compare saves"
        aria-busy={loading}
      >
        <div className="comparison-control-layout">
          <div className="comparison-control-copy">
            <span className="eyebrow">World comparison</span>
            <h2>Compare Saves</h2>
            <p>See how your world changed between two saves.</p>
            <p className="micro-copy">
              All values show the difference <strong>Target − Base</strong>.
            </p>
            <p className="micro-copy">
              Direction is never reordered by date. Comparing the same save is
              supported.
            </p>
          </div>
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
                        {item.fileName} — {item.gameDate || "—"} ·{" "}
                        {new Date(item.analyzedAt).toLocaleString()}
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
              disabled={!base || !target}
              onClick={() => {
                cancel();
                setError("");
                setBaseHash(targetHash);
                setTargetHash(baseHash);
              }}
            >
              Swap
            </button>
          </div>
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
        <p className="micro-copy" role="status" aria-live="polite">
          {loading ? "Loading saved analyses for comparison…" : error}
        </p>
        {completed &&
          (completed.data.baseHash !== baseHash ||
            completed.data.targetHash !== targetHash) && (
            <p className="micro-copy">
              Showing the last completed comparison below. Press Compare to
              update it.
            </p>
          )}
      </section>
      {completed && <AnalysisComparisonResults {...completed} />}
    </>
  );
}
