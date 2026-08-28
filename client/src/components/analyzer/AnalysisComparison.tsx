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
        <h2>Compare saves</h2>
        <p className="micro-copy">
          Choose Base and Target from available saved analyses. Direction is
          never reordered by date. Choose the same analysis in both slots to
          check for differences.
        </p>
        <div className="analyzer-recent-controls">
          {(["base", "target"] as const).map((side) => (
            <label key={side} htmlFor={`compare-${side}`}>
              {side === "base" ? "Base analysis" : "Target analysis"}
              <select
                id={`compare-${side}`}
                value={
                  side === "base" ? (base?.hash ?? "") : (target?.hash ?? "")
                }
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
            </label>
          ))}
        </div>
        <div className="comparison-actions">
          <button
            className="button button-secondary"
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
