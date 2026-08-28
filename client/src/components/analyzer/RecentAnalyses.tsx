import { useEffect, useState } from "react";
import type { RecentAnalysis } from "@/types";

export function RecentAnalyses({
  refreshVersion,
  onOpen,
  openingHash = null,
  openError = "",
  analyzing = false,
}: {
  refreshVersion: number;
  onOpen: (item: RecentAnalysis) => void;
  openingHash?: string | null;
  openError?: string;
  analyzing?: boolean;
}) {
  const [items, setItems] = useState<RecentAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const response = await fetch("/api/analyze/recent", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("History unavailable");
        const data = (await response.json()) as { items: RecentAnalysis[] };
        if (!Array.isArray(data.items))
          throw new Error("Invalid history response");
        if (active) setItems(data.items);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshVersion, retry]);

  return (
    <section
      className="panel analyzer-recent"
      aria-label="Recent Analyses"
      aria-busy={loading}
    >
      <div className="panel-head">
        <h2>Recent Analyses</h2>
        {failed && (
          <button
            className="button button-secondary"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry history
          </button>
        )}
      </div>
      <p className="micro-copy">
        Reopen a saved analysis without uploading again. Original save files are
        not stored.
      </p>
      <div className="micro-copy" role="status" aria-live="polite">
        {loading
          ? "Loading recent analyses…"
          : failed
            ? "Recent history is unavailable. You can still analyze saves."
            : items.length === 0
              ? "No recent analyses yet."
              : ""}
      </div>
      <div className="micro-copy" role="status" aria-live="polite">
        {openingHash ? "Opening saved analysis…" : openError}
      </div>
      {items.length > 0 && (
        <div className="table-wrap analyzer-recent-scroll">
          <table className="recent-table analyzer-recent-table">
            <thead>
              <tr>
                <th>Save file</th>
                <th>Game date</th>
                <th>Analyzed</th>
                <th className="numeric-cell">Divisions</th>
                <th className="numeric-cell">Ships</th>
                <th className="analyzer-recent-action">Result</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.hash} aria-busy={openingHash === item.hash}>
                  <td>{item.fileName}</td>
                  <td>{item.gameDate}</td>
                  <td>
                    <time dateTime={item.analyzedAt}>
                      {new Date(item.analyzedAt).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </td>
                  <td className="numeric-cell">
                    {item.divisionCount.toLocaleString()}
                  </td>
                  <td className="numeric-cell">
                    {item.shipCount.toLocaleString()}
                  </td>
                  <td className="analyzer-recent-action">
                    {item.hasPersistedResult === true ? (
                      <button
                        className="button button-secondary"
                        aria-label={`Open analysis ${item.fileName}`}
                        disabled={openingHash !== null || analyzing}
                        onClick={() => onOpen(item)}
                      >
                        {openingHash === item.hash ? "Opening…" : "Open result"}
                      </button>
                    ) : (
                      <span className="micro-copy">Not saved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
