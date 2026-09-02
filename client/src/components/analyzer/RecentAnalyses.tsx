import { useEffect, useMemo, useRef, useState } from "react";
import type { RecentAnalysis } from "@/types";
import { ANALYZER_UNAVAILABLE_MESSAGE } from "@/lib/analysis-error";
import { AnalysisComparison } from "./AnalysisComparison";
import {
  ShareAnalysisDialog,
  type PublicShareLink,
} from "./ShareAnalysisDialog";
import { AnalysisStorageManagement } from "./AnalysisStorageManagement";

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

type RecentIconName =
  | "history"
  | "search"
  | "calendar"
  | "clock"
  | "manpower"
  | "aircraft"
  | "available"
  | "unavailable"
  | "open"
  | "share"
  | "pin"
  | "delete";

function RecentIcon({ name }: { name: RecentIconName }) {
  return (
    <svg
      className="recent-icon"
      data-recent-icon={name}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === "history" && (
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5M12 7v5l3 2" />
        </>
      )}
      {name === "search" && (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </>
      )}
      {name === "clock" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {name === "manpower" && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 5.3a3 3 0 0 1 0 5.4M17 14a5 5 0 0 1 3.5 4.8V20" />
        </>
      )}
      {name === "aircraft" && (
        <path d="m22 16-9-5.5V4.8c0-1.4-.4-2.8-1-2.8s-1 1.4-1 2.8v5.7L2 16v2l9-2.8V20l-2 1.5V23l3-1 3 1v-1.5L13 20v-4.8l9 2.8Z" />
      )}
      {name === "available" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </>
      )}
      {name === "unavailable" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </>
      )}
      {name === "open" && (
        <>
          <path d="M5 12h14M14 7l5 5-5 5" />
          <path d="M5 5H3v14h2" />
        </>
      )}
      {name === "share" && (
        <>
          <circle cx="18" cy="5" r="2.5" />
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="19" r="2.5" />
          <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
        </>
      )}
      {name === "pin" && (
        <>
          <path d="m14 4 6 6-3 1-4 4-1 4-2-2-2-2 4-1 4-4Z" />
          <path d="m9 15-5 5" />
        </>
      )}
      {name === "delete" && (
        <>
          <path d="M4 7h16M9 7V4h6v3M6.5 7l1 14h9l1-14M10 11v6M14 11v6" />
        </>
      )}
    </svg>
  );
}

function recentCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value.toLocaleString()
    : "—";
}

function analyzedDate(value: string): { date: string; time: string } {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { date: "—", time: "" };
  return {
    date: date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    time: date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export function RecentAnalyses({
  refreshVersion,
  onOpen,
  openingHash = null,
  openError = "",
  analyzing = false,
  onAnalyzeSave,
  onImportCampaign,
}: {
  refreshVersion: number;
  onOpen: (item: RecentAnalysis) => void;
  openingHash?: string | null;
  openError?: string;
  analyzing?: boolean;
  onAnalyzeSave?: () => void;
  onImportCampaign?: () => void;
}) {
  const [items, setItems] = useState<RecentAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [mutation, setMutation] = useState<{
    hash: string;
    action: "delete" | "pin";
  } | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
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
    if (mutation || storageBusy) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    setFailureMessage("");
    void (async () => {
      let reachedService = false;
      try {
        const response = await fetch("/api/analyze/recent", {
          signal: controller.signal,
        });
        reachedService = true;
        if (!response.ok) throw new Error("History unavailable");
        const data = (await response.json()) as { items: RecentAnalysis[] };
        if (!Array.isArray(data.items))
          throw new Error("Invalid history response");
        if (active) setItems(data.items);
      } catch {
        if (active) {
          setFailed(true);
          setFailureMessage(
            reachedService
              ? "Recent analyses could not be loaded. Check the analyzer storage and try again."
              : ANALYZER_UNAVAILABLE_MESSAGE,
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [refreshVersion, retry, mutation, storageBusy]);

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
    if (
      mutationInFlight.current ||
      openingHash !== null ||
      shareItem ||
      storageBusy
    )
      return;
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
        id="recent-analyses"
        className="panel analyzer-recent"
        aria-label="Recent Analyses"
        aria-busy={loading || mutation !== null || storageBusy}
      >
        <div className="analyzer-recent-header">
          <div className="analyzer-recent-heading">
            <span className="analyzer-recent-heading-icon">
              <RecentIcon name="history" />
            </span>
            <div>
              <h2>Recent Analyses</h2>
              <p className="micro-copy">
                Reopen a saved analysis without uploading again.
                <br />
                Original save files are not stored.
              </p>
            </div>
          </div>
        </div>
        <AnalysisStorageManagement
          items={items}
          refreshVersion={refreshVersion}
          disabled={
            loading ||
            mutation !== null ||
            openingHash !== null ||
            analyzing ||
            shareItem !== null
          }
          onBusyChange={setStorageBusy}
          onChanged={(next, message) => {
            setItems(next);
            setActionMessage(message);
          }}
        />
        {failed && (
          <div className="recovery-notice" role="alert">
            <div>
              <strong>
                {items.length
                  ? "Could not refresh recent analyses"
                  : "Recent analyses unavailable"}
              </strong>
              <span>
                {failureMessage}
                {items.length
                  ? " The existing list remains available below."
                  : " You can still analyze saves."}
              </span>
            </div>
            <button
              className="button button-secondary"
              onClick={() => setRetry((value) => value + 1)}
              disabled={loading}
            >
              Try again
            </button>
          </div>
        )}
        {items.length > 0 && (
          <>
            <div className="analyzer-recent-controls">
              <label htmlFor="recent-analysis-search">
                Search analyses
                <span className="analyzer-recent-control">
                  <RecentIcon name="search" />
                  <input
                    id="recent-analysis-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filename or game date"
                  />
                </span>
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
              Pinned analyses appear first. Pins are retained when possible,
              within history limits.
            </p>
          </>
        )}
        <div className="analyzer-recent-statuses">
          <div className="micro-copy" role="status" aria-live="polite">
            {loading
              ? "Loading recent analyses…"
              : items.length === 0
                ? ""
                : visibleItems.length === 0
                  ? "No analyses found."
                  : `Showing ${visibleItems.length} of ${items.length} analyses.`}
          </div>
          <div className="micro-copy" role="status" aria-live="polite">
            {openingHash ? "Opening saved analysis…" : ""}
          </div>
          <div className="micro-copy" role="status" aria-live="polite">
            {mutation
              ? mutation.action === "delete"
                ? "Deleting saved analysis…"
                : "Updating pin…"
              : actionMessage}
          </div>
        </div>
        {openError && (
          <div className="recovery-notice" role="alert">
            <div>
              <strong>Saved analysis unavailable</strong>
              <span>{openError}</span>
            </div>
            {onAnalyzeSave && (
              <button
                className="button button-secondary"
                onClick={onAnalyzeSave}
                disabled={analyzing || openingHash !== null}
              >
                Analyze save again
              </button>
            )}
          </div>
        )}
        {!loading && !failed && items.length === 0 && (
          <div className="product-empty-state">
            <div>
              <h3>No analyses yet</h3>
              <p>
                Completed save analyses appear here, ready to reopen without
                uploading the save again.
              </p>
            </div>
            {(onAnalyzeSave || onImportCampaign) && (
              <div className="product-empty-actions">
                {onAnalyzeSave && (
                  <button
                    className="button button-primary"
                    onClick={onAnalyzeSave}
                  >
                    Analyze Save
                  </button>
                )}
                {onImportCampaign && (
                  <button
                    className="button button-secondary"
                    onClick={onImportCampaign}
                  >
                    Import Campaign
                  </button>
                )}
              </div>
            )}
          </div>
        )}
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
                  <th className="numeric-cell">Manpower in field</th>
                  <th className="numeric-cell">Aircraft</th>
                  <th>Result</th>
                  <th className="analyzer-recent-action">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const analyzed = analyzedDate(item.analyzedAt);
                  return (
                    <tr
                      key={item.hash}
                      aria-busy={
                        openingHash === item.hash ||
                        mutation?.hash === item.hash
                      }
                    >
                      <td>
                        <div className="analyzer-recent-name-line">
                          <span className="analyzer-recent-name">
                            {item.fileName}
                          </span>
                          {item.pinned && (
                            <span
                              className="analyzer-recent-pin-state"
                              aria-label="Pinned analysis"
                              title="Pinned analysis"
                            >
                              <RecentIcon name="pin" />
                            </span>
                          )}
                        </div>
                        <div className="micro-copy">
                          {fileSize(item.fileSizeBytes)}
                        </div>
                      </td>
                      <td>
                        <span className="analyzer-recent-meta">
                          <RecentIcon name="calendar" />
                          <span>{item.gameDate || "—"}</span>
                        </span>
                      </td>
                      <td>
                        <time dateTime={item.analyzedAt}>
                          <span className="analyzer-recent-meta">
                            <RecentIcon name="clock" />
                            <span>
                              <span className="analyzer-recent-date">
                                {analyzed.date}
                              </span>
                              {analyzed.time && (
                                <span className="micro-copy">
                                  {analyzed.time}
                                </span>
                              )}
                            </span>
                          </span>
                        </time>
                      </td>
                      <td className="numeric-cell analyzer-recent-manpower">
                        <span className="analyzer-recent-metric">
                          <RecentIcon name="manpower" />
                          <span>{recentCount(item.manpowerInField)}</span>
                        </span>
                      </td>
                      <td className="numeric-cell analyzer-recent-aircraft">
                        <span className="analyzer-recent-metric">
                          <RecentIcon name="aircraft" />
                          <span>{recentCount(item.aircraftCount)}</span>
                        </span>
                      </td>
                      <td>
                        <span
                          className={`analyzer-recent-result ${item.hasPersistedResult ? "available" : "unavailable"}`}
                          title={
                            item.hasPersistedResult
                              ? "Saved analysis can be opened."
                              : "Analyze the original save again to make this result available."
                          }
                        >
                          <RecentIcon
                            name={
                              item.hasPersistedResult
                                ? "available"
                                : "unavailable"
                            }
                          />
                          {item.hasPersistedResult
                            ? "Available"
                            : "Unavailable"}
                        </span>
                      </td>
                      <td className="analyzer-recent-action">
                        <div className="analyzer-recent-actions">
                          {item.hasPersistedResult === true ? (
                            <>
                              <button
                                className="button analyzer-recent-open"
                                aria-label={`Open analysis ${item.fileName}`}
                                disabled={
                                  openingHash !== null ||
                                  analyzing ||
                                  mutation !== null ||
                                  storageBusy ||
                                  shareItem !== null
                                }
                                onClick={() => {
                                  if (!mutationInFlight.current) onOpen(item);
                                }}
                              >
                                <RecentIcon name="open" />
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
                                  storageBusy ||
                                  shareItem !== null
                                }
                                onClick={() => setShareItem(item)}
                              >
                                <RecentIcon name="share" />
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
                              storageBusy ||
                              openingHash !== null ||
                              shareItem !== null
                            }
                            onClick={() => void manage(item, "pin")}
                          >
                            <RecentIcon name="pin" />
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
                              storageBusy ||
                              openingHash !== null ||
                              shareItem !== null
                            }
                            onClick={() => void manage(item, "delete")}
                          >
                            <RecentIcon name="delete" />
                            {mutation?.hash === item.hash &&
                            mutation.action === "delete"
                              ? "Deleting…"
                              : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
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
          storageBusy ||
          openingHash !== null ||
          analyzing
        }
        onUnavailable={() => setRetry((value) => value + 1)}
        optionsLoading={loading}
        optionsUnavailable={failed}
        onRetryOptions={() => setRetry((value) => value + 1)}
        onAnalyzeSave={onAnalyzeSave}
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
