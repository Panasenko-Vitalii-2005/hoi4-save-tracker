import { useEffect, useMemo, useRef, useState } from "react";
import type { RecentAnalysis } from "@/types";
import { AnalysisComparison } from "./AnalysisComparison";
import {
  ShareAnalysisDialog,
  type PublicShareLink,
} from "./ShareAnalysisDialog";

type SortOrder =
  | "newest"
  | "oldest"
  | "name-asc"
  | "name-desc"
  | "game-newest"
  | "game-oldest";

function gameDateKey(date: string): number | null {
  if (typeof date !== "string" || !/^\d+\.\d{1,2}\.\d{1,2}$/.test(date))
    return null;
  const [year, month, day] = date.split(".").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const key = year * 372 + (month - 1) * 31 + day;
  return year > 0 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    Number.isSafeInteger(key)
    ? key
    : null;
}

function compareDates(
  a: number | null,
  b: number | null,
  ascending: boolean,
): number {
  // Invalid dates stay last in either direction; stable ties retain fetched order.
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
}

function fileSize(bytes: number): string {
  const unit = bytes >= 1024 ** 2 ? "MiB" : bytes >= 1024 ? "KiB" : "B";
  const divisor = unit === "MiB" ? 1024 ** 2 : unit === "KiB" ? 1024 : 1;
  return `${(bytes / divisor).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

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
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [mutation, setMutation] = useState<{
    hash: string;
    action: "delete" | "pin";
  } | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [shareItem, setShareItem] = useState<RecentAnalysis | null>(null);
  const [knownShares, setKnownShares] = useState<
    ReadonlyMap<string, PublicShareLink>
  >(new Map());
  const mutationInFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Cancel stale lists while a mutation is running; refetch after it settles,
    // including any analysis completion that happened in the meantime.
    if (mutation) return;
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
  }, [refreshVersion, retry, mutation]);

  const visibleItems = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return items
      .filter(
        (item) =>
          !search ||
          item.fileName.toLocaleLowerCase().includes(search) ||
          (item.gameDate ?? "").includes(search),
      )
      .sort((a, b) => {
        const pinned = Number(b.pinned === true) - Number(a.pinned === true);
        if (pinned) return pinned;
        if (sortOrder === "name-asc" || sortOrder === "name-desc")
          return (
            a.fileName.localeCompare(b.fileName, undefined, {
              sensitivity: "base",
            }) * (sortOrder === "name-asc" ? 1 : -1)
          );
        if (sortOrder === "game-newest" || sortOrder === "game-oldest")
          return compareDates(
            gameDateKey(a.gameDate),
            gameDateKey(b.gameDate),
            sortOrder === "game-oldest",
          );
        const analyzed = (value: string) => {
          const key = Date.parse(value);
          return Number.isFinite(key) ? key : null;
        };
        return compareDates(
          analyzed(a.analyzedAt),
          analyzed(b.analyzedAt),
          sortOrder === "oldest",
        );
      });
  }, [items, query, sortOrder]);

  const manage = async (item: RecentAnalysis, action: "delete" | "pin") => {
    if (mutationInFlight.current || openingHash !== null || shareItem) return;
    if (
      action === "delete" &&
      !window.confirm(
        `Delete the saved analysis for "${item.fileName}"? The original save and any currently displayed result will remain unchanged. An active public link will remain available until it is revoked.`,
      )
    )
      return;
    mutationInFlight.current = true;
    setMutation({ hash: item.hash, action });
    setLoading(false);
    setActionMessage("");
    try {
      const response = await fetch(
        `/api/analyze/recent/${encodeURIComponent(item.hash)}`,
        action === "delete"
          ? { method: "DELETE" }
          : {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pinned: !item.pinned }),
            },
      );
      if (!response.ok) throw new Error("History update failed");
      const data = (await response.json()) as { items: RecentAnalysis[] };
      if (!Array.isArray(data.items))
        throw new Error("Invalid history response");
      if (mounted.current) {
        setItems(data.items);
        setActionMessage(
          action === "delete"
            ? "Saved analysis deleted."
            : item.pinned
              ? "Analysis unpinned."
              : "Analysis pinned.",
        );
      }
    } catch {
      if (mounted.current)
        setActionMessage(
          action === "delete"
            ? "Could not delete the saved analysis. Please try again."
            : "Could not update the pin. Please try again.",
        );
    } finally {
      mutationInFlight.current = false;
      if (mounted.current) setMutation(null);
    }
  };

  return (
    <>
      <section
        className="panel analyzer-recent"
        aria-label="Recent Analyses"
        aria-busy={loading || mutation !== null}
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
          Reopen a saved analysis without uploading again. Original save files
          are not stored.
        </p>
        <div className="analyzer-recent-controls">
          <label htmlFor="recent-analysis-search">
            Search analyses
            <input
              id="recent-analysis-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filename or game date"
            />
          </label>
          <label htmlFor="recent-analysis-sort">
            Sort analyses
            <select
              id="recent-analysis-sort"
              value={sortOrder}
              onChange={(event) =>
                setSortOrder(event.target.value as SortOrder)
              }
            >
              <option value="newest">Newest analyzed</option>
              <option value="oldest">Oldest analyzed</option>
              <option value="name-asc">Filename A–Z</option>
              <option value="name-desc">Filename Z–A</option>
              <option value="game-newest">Game date newest</option>
              <option value="game-oldest">Game date oldest</option>
            </select>
          </label>
        </div>
        <p className="micro-copy">
          Pinned analyses appear first. Pins are retained when possible, within
          history limits.
        </p>
        <div className="micro-copy" role="status" aria-live="polite">
          {loading
            ? "Loading recent analyses…"
            : failed
              ? "Recent history is unavailable. You can still analyze saves."
              : items.length === 0
                ? "No recent analyses yet."
                : visibleItems.length === 0
                  ? "No analyses found."
                  : `Showing ${visibleItems.length} of ${items.length} analyses.`}
        </div>
        <div className="micro-copy" role="status" aria-live="polite">
          {openingHash ? "Opening saved analysis…" : openError}
        </div>
        <div className="micro-copy" role="status" aria-live="polite">
          {mutation
            ? mutation.action === "delete"
              ? "Deleting saved analysis…"
              : "Updating pin…"
            : actionMessage}
        </div>
        {visibleItems.length > 0 && (
          <div
            className="table-wrap analyzer-recent-scroll"
            role="region"
            aria-label="Recent analyses table"
            tabIndex={0}
          >
            <table className="recent-table analyzer-recent-table">
              <thead>
                <tr>
                  <th>Save file</th>
                  <th>Game date</th>
                  <th>Analyzed</th>
                  <th className="numeric-cell">Divisions</th>
                  <th className="numeric-cell">Ships</th>
                  <th className="numeric-cell">Naval losses</th>
                  <th>Result</th>
                  <th className="analyzer-recent-action">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr
                    key={item.hash}
                    aria-busy={
                      openingHash === item.hash || mutation?.hash === item.hash
                    }
                  >
                    <td>
                      <span className="analyzer-recent-name">
                        {item.fileName}
                      </span>
                      <div className="micro-copy">
                        {fileSize(item.fileSizeBytes)}
                        {item.pinned ? " · Pinned" : ""}
                      </div>
                    </td>
                    <td>{item.gameDate || "—"}</td>
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
                    <td className="numeric-cell">
                      {item.navalLossCount.toLocaleString()}
                    </td>
                    <td>
                      <span
                        title={
                          item.hasPersistedResult
                            ? "Saved analysis can be opened."
                            : "Analyze the original save again to make this result available."
                        }
                      >
                        {item.hasPersistedResult ? "Available" : "Unavailable"}
                      </span>
                    </td>
                    <td className="analyzer-recent-action">
                      <div className="analyzer-recent-actions">
                        {item.hasPersistedResult === true ? (
                          <>
                            <button
                              className="button button-secondary"
                              aria-label={`Open analysis ${item.fileName}`}
                              disabled={
                                openingHash !== null ||
                                analyzing ||
                                mutation !== null ||
                                shareItem !== null
                              }
                              onClick={() => {
                                if (!mutationInFlight.current) onOpen(item);
                              }}
                            >
                              {openingHash === item.hash
                                ? "Opening…"
                                : "Open result"}
                            </button>
                            <button
                              className="button button-secondary"
                              aria-label={`Share analysis ${item.fileName}`}
                              disabled={
                                openingHash !== null ||
                                analyzing ||
                                mutation !== null ||
                                shareItem !== null
                              }
                              onClick={() => setShareItem(item)}
                            >
                              Share
                            </button>
                          </>
                        ) : null}
                        <button
                          className="button button-secondary"
                          aria-label={`${item.pinned ? "Unpin" : "Pin"} analysis ${item.fileName}`}
                          aria-pressed={item.pinned === true}
                          disabled={
                            mutation !== null ||
                            openingHash !== null ||
                            shareItem !== null
                          }
                          onClick={() => void manage(item, "pin")}
                        >
                          {mutation?.hash === item.hash &&
                          mutation.action === "pin"
                            ? "Updating…"
                            : item.pinned
                              ? "Unpin"
                              : "Pin"}
                        </button>
                        <button
                          className="button button-secondary analyzer-recent-delete"
                          aria-label={`Delete analysis ${item.fileName}`}
                          disabled={
                            mutation !== null ||
                            openingHash !== null ||
                            shareItem !== null
                          }
                          onClick={() => void manage(item, "delete")}
                        >
                          {mutation?.hash === item.hash &&
                          mutation.action === "delete"
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <AnalysisComparison
        items={items}
        busy={
          loading ||
          failed ||
          mutation !== null ||
          openingHash !== null ||
          analyzing
        }
        onUnavailable={() => setRetry((value) => value + 1)}
      />
      {shareItem && (
        <ShareAnalysisDialog
          item={shareItem}
          initialLink={knownShares.get(shareItem.hash)}
          onClose={() => setShareItem(null)}
          onCreated={(link) =>
            setKnownShares((current) => {
              const next = new Map(current);
              next.set(shareItem.hash, link);
              return next;
            })
          }
          onRevoked={() => {
            setKnownShares((current) => {
              const next = new Map(current);
              next.delete(shareItem.hash);
              return next;
            });
            setActionMessage("Public link revoked.");
          }}
        />
      )}
    </>
  );
}
