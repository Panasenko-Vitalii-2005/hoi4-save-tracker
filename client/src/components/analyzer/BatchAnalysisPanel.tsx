import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ANALYZER_UNAVAILABLE_MESSAGE,
  analysisError,
} from "@/lib/analysis-error";

type BatchStatus =
  | "identifying"
  | "already_analyzed"
  | "queued"
  | "analyzing"
  | "completed"
  | "failed"
  | "invalid"
  | "duplicate"
  | "cancelled";

interface BatchItem {
  id: number;
  file: File;
  hash: string | null;
  status: BatchStatus;
  error: string | null;
  gameDate: string | null;
}

interface BatchAcknowledgement {
  hash: string;
  gameDate: string;
  campaignId: string | null;
}

const PREFLIGHT_CHUNK_SIZE = 200;
const PREFLIGHT_UNAVAILABLE =
  "Could not check existing analyses. No saves were uploaded.";

const STATUS_COPY: Record<BatchStatus, { symbol: string; label: string }> = {
  identifying: { symbol: "…", label: "Identifying" },
  already_analyzed: { symbol: "✓", label: "Already analyzed" },
  queued: { symbol: "○", label: "Queued" },
  analyzing: { symbol: "→", label: "Uploading & analyzing" },
  completed: { symbol: "✓", label: "Completed" },
  failed: { symbol: "!", label: "Failed" },
  invalid: { symbol: "!", label: "Invalid" },
  duplicate: { symbol: "↷", label: "Duplicate selection" },
  cancelled: { symbol: "–", label: "Cancelled" },
};

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
}

async function hashSaveFile(file: File): Promise<string> {
  // Web Crypto has no streaming SHA-256 API. Files are therefore hashed one at
  // a time so the batch never retains multiple raw save buffers concurrently.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function validAcknowledgement(
  value: unknown,
  expectedHash: string,
): value is BatchAcknowledgement {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.hash === expectedHash &&
    typeof record.gameDate === "string" &&
    (record.campaignId === null || typeof record.campaignId === "string")
  );
}

export interface BatchAnalysisPanelHandle {
  openPicker: () => void;
}

export const BatchAnalysisPanel = forwardRef<
  BatchAnalysisPanelHandle,
  {
    disabled?: boolean;
    onRunningChange?: (running: boolean) => void;
    onHistoryChanged?: () => void;
    onNavigateToCampaignTrends?: () => void;
  }
>(function BatchAnalysisPanel(
  {
    disabled = false,
    onRunningChange,
    onHistoryChanged,
    onNavigateToCampaignTrends,
  },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<BatchItem[]>([]);
  const generationRef = useRef(0);
  const cancelRef = useRef(false);
  const nextId = useRef(0);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "identifying" | "review" | "running" | "complete"
  >("idle");
  const [identifyProgress, setIdentifyProgress] = useState({
    done: 0,
    total: 0,
  });
  const [preflightError, setPreflightError] = useState("");
  const [filter, setFilter] = useState<"all" | BatchStatus>("all");

  useImperativeHandle(ref, () => ({
    openPicker: () => inputRef.current?.click(),
  }));

  const updateItems = (
    update: BatchItem[] | ((current: BatchItem[]) => BatchItem[]),
  ) => {
    setItems((current) => {
      const next = typeof update === "function" ? update(current) : update;
      itemsRef.current = next;
      return next;
    });
  };

  const counts = useMemo(() => {
    const count = (status: BatchStatus) =>
      items.filter((item) => item.status === status).length;
    return {
      selected: items.length,
      known: count("already_analyzed"),
      queued: count("queued"),
      analyzing: count("analyzing"),
      completed: count("completed"),
      failed: count("failed"),
      invalid: count("invalid"),
      duplicates: count("duplicate"),
      cancelled: count("cancelled"),
    };
  }, [items]);
  const failureGroups = useMemo(() => {
    const groups = new Map<string, number>();
    for (const item of items) {
      if (item.status !== "failed" || !item.error) continue;
      groups.set(item.error, (groups.get(item.error) ?? 0) + 1);
    }
    return [...groups].map(([message, count]) => ({ message, count }));
  }, [items]);
  const completionSummary = useMemo(
    () =>
      [
        `${counts.selected} selected`,
        counts.known ? `${counts.known} already analyzed` : "",
        `${counts.completed} analyzed successfully`,
        `${counts.failed} failed`,
        counts.cancelled ? `${counts.cancelled} cancelled` : "",
        counts.invalid ? `${counts.invalid} invalid` : "",
        counts.duplicates ? `${counts.duplicates} duplicates skipped` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    [counts],
  );

  const visibleItems = useMemo(
    () =>
      filter === "all" ? items : items.filter((item) => item.status === filter),
    [filter, items],
  );
  const current = items.find((item) => item.status === "analyzing");
  const processed = items.filter((item) =>
    [
      "already_analyzed",
      "completed",
      "failed",
      "invalid",
      "duplicate",
      "cancelled",
    ].includes(item.status),
  ).length;

  const runPreflight = async (
    candidateItems: BatchItem[],
    generation: number,
  ) => {
    const hashes = candidateItems
      .filter((item) => item.status === "identifying" && item.hash)
      .map((item) => item.hash!);
    const known = new Set<string>();
    for (let index = 0; index < hashes.length; index += PREFLIGHT_CHUNK_SIZE) {
      const chunk = hashes.slice(index, index + PREFLIGHT_CHUNK_SIZE);
      let response: Response;
      try {
        response = await fetch("/api/analyze/batch/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hashes: chunk }),
        });
      } catch {
        throw new Error(ANALYZER_UNAVAILABLE_MESSAGE);
      }
      if (!response.ok) throw new Error(PREFLIGHT_UNAVAILABLE);
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !Array.isArray((value as Record<string, unknown>).knownHashes)
      )
        throw new Error(PREFLIGHT_UNAVAILABLE);
      for (const hash of (value as { knownHashes: unknown[] }).knownHashes) {
        if (typeof hash === "string" && chunk.includes(hash)) known.add(hash);
      }
    }
    if (generation !== generationRef.current) return;
    updateItems((currentItems) =>
      currentItems.map((item) =>
        item.status !== "identifying" || !item.hash
          ? item
          : {
              ...item,
              status: known.has(item.hash) ? "already_analyzed" : "queued",
            },
      ),
    );
    setPhase("review");
  };

  const prepare = async (files: File[]) => {
    if (phase === "running" || disabled) return;
    const generation = ++generationRef.current;
    cancelRef.current = false;
    setPreflightError("");
    setFilter("all");
    setPhase("identifying");
    setIdentifyProgress({ done: 0, total: files.length });
    const prepared: BatchItem[] = files.map((file) => ({
      id: nextId.current++,
      file,
      hash: null,
      status:
        !file.name.toLowerCase().endsWith(".hoi4") || file.size === 0
          ? "invalid"
          : "identifying",
      error: !file.name.toLowerCase().endsWith(".hoi4")
        ? "Choose a .hoi4 save file."
        : file.size === 0
          ? "The save is empty."
          : null,
      gameDate: null,
    }));
    updateItems(prepared);

    const seen = new Set<string>();
    for (let index = 0; index < prepared.length; index++) {
      const item = prepared[index];
      if (generation !== generationRef.current) return;
      if (item.status === "identifying") {
        try {
          const hash = await hashSaveFile(item.file);
          item.hash = hash;
          if (seen.has(hash)) item.status = "duplicate";
          else seen.add(hash);
        } catch {
          item.status = "invalid";
          item.error = "Could not identify this save in the browser.";
        }
      }
      setIdentifyProgress({ done: index + 1, total: prepared.length });
      updateItems([...prepared]);
    }

    try {
      await runPreflight(prepared, generation);
    } catch (error: unknown) {
      if (generation !== generationRef.current) return;
      setPreflightError(
        error instanceof Error &&
          error.message === ANALYZER_UNAVAILABLE_MESSAGE
          ? error.message
          : PREFLIGHT_UNAVAILABLE,
      );
      setPhase("review");
    }
  };

  const retryPreflight = async () => {
    const generation = generationRef.current;
    setPreflightError("");
    setPhase("identifying");
    try {
      await runPreflight(itemsRef.current, generation);
    } catch (error: unknown) {
      setPreflightError(
        error instanceof Error &&
          error.message === ANALYZER_UNAVAILABLE_MESSAGE
          ? error.message
          : PREFLIGHT_UNAVAILABLE,
      );
      setPhase("review");
    }
  };

  const processIds = async (ids: number[]) => {
    cancelRef.current = false;
    setPhase("running");
    onRunningChange?.(true);
    let completedThisRun = 0;
    try {
      for (const id of ids) {
        if (cancelRef.current) break;
        const item = itemsRef.current.find((entry) => entry.id === id);
        if (!item || !item.hash) continue;
        updateItems((currentItems) =>
          currentItems.map((entry) =>
            entry.id === id
              ? { ...entry, status: "analyzing", error: null }
              : entry,
          ),
        );
        let failureMessage = ANALYZER_UNAVAILABLE_MESSAGE;
        try {
          const formData = new FormData();
          formData.append("file", item.file);
          const response = await fetch("/api/analyze?response=batch", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            const safe = await analysisError(response);
            failureMessage = safe.msg;
            throw new Error(safe.msg);
          }
          failureMessage =
            "The analysis response could not be read. Try this save again.";
          const acknowledgement: unknown = await response.json();
          if (!validAcknowledgement(acknowledgement, item.hash)) {
            throw new Error(failureMessage);
          }
          completedThisRun++;
          updateItems((currentItems) =>
            currentItems.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    status: "completed",
                    gameDate: acknowledgement.gameDate,
                  }
                : entry,
            ),
          );
        } catch {
          updateItems((currentItems) =>
            currentItems.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    status: "failed",
                    error: failureMessage,
                  }
                : entry,
            ),
          );
        }
        // Yield between files. The backend remains the authoritative admission
        // boundary, while this prevents a browser batch from flooding requests.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (cancelRef.current) {
        updateItems((currentItems) =>
          currentItems.map((entry) =>
            entry.status === "queued"
              ? { ...entry, status: "cancelled" }
              : entry,
          ),
        );
      }
    } finally {
      setPhase("complete");
      onRunningChange?.(false);
      if (completedThisRun > 0) onHistoryChanged?.();
    }
  };

  const start = () => {
    const ids = itemsRef.current
      .filter((item) => item.status === "queued")
      .map((item) => item.id);
    if (ids.length) void processIds(ids);
  };

  const retryFailed = () => {
    const failed = itemsRef.current.filter((item) => item.status === "failed");
    updateItems((currentItems) =>
      currentItems.map((item) =>
        item.status === "failed"
          ? { ...item, status: "queued", error: null }
          : item,
      ),
    );
    void processIds(failed.map((item) => item.id));
  };

  const cancel = () => {
    cancelRef.current = true;
    updateItems((currentItems) =>
      currentItems.map((item) =>
        item.status === "queued" ? { ...item, status: "cancelled" } : item,
      ),
    );
  };

  return (
    <section
      id="import-campaign"
      className="panel batch-analysis-panel"
      aria-labelledby="batch-analysis-title"
      data-phase={phase}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled && phase !== "running")
          void prepare(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="panel-head batch-analysis-head">
        <div>
          <span className="batch-analysis-eyebrow">Campaign import</span>
          <h2 id="batch-analysis-title">Import campaign</h2>
          <p>
            Select or drop multiple .hoi4 saves. Already analyzed saves are
            skipped; only new saves are analyzed and added to Campaign Trends.
          </p>
        </div>
        <button
          className="button button-secondary"
          disabled={disabled || phase === "running" || phase === "identifying"}
          onClick={() => inputRef.current?.click()}
        >
          Import Campaign
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".hoi4"
          multiple
          hidden
          aria-label="Import multiple .hoi4 saves"
          disabled={disabled || phase === "running"}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            if (selected.length) void prepare(selected);
            event.target.value = "";
          }}
        />
      </div>

      {phase === "idle" ? (
        <div className="batch-analysis-drop-hint">
          Drop multiple .hoi4 saves here, or use Import Campaign.
        </div>
      ) : (
        <>
          <div className="batch-analysis-summary" aria-live="polite">
            <div>
              <strong>{counts.selected}</strong>
              <span>Selected</span>
            </div>
            <div>
              <strong>{counts.known}</strong>
              <span>Already analyzed</span>
            </div>
            <div>
              <strong>{counts.queued}</strong>
              <span>New</span>
            </div>
            <div>
              <strong>{counts.invalid}</strong>
              <span>Invalid</span>
            </div>
            <div>
              <strong>{counts.duplicates}</strong>
              <span>Duplicates skipped</span>
            </div>
          </div>

          {phase === "identifying" && (
            <div className="batch-analysis-progress" role="status">
              <span className="spinner" aria-hidden="true" />
              Identifying saves {identifyProgress.done} /{" "}
              {identifyProgress.total}…
            </div>
          )}

          {phase === "running" && (
            <div className="batch-analysis-progress" role="status">
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>Analyzing campaign saves</strong>
                <span>
                  {processed} / {items.length} processed
                </span>
                {current && <span>Current: {current.file.name}</span>}
              </div>
            </div>
          )}

          {preflightError && (
            <div className="batch-analysis-error" role="alert">
              <span>{preflightError}</span>
              <button
                className="button button-secondary"
                onClick={() => void retryPreflight()}
              >
                Try again
              </button>
            </div>
          )}

          {phase === "complete" && (
            <div className="batch-analysis-complete" role="status">
              <div>
                <strong>Batch complete</strong>
                <span>{completionSummary}</span>
              </div>
              <div className="batch-analysis-actions">
                {counts.failed > 0 && (
                  <button
                    className="button button-secondary"
                    onClick={retryFailed}
                  >
                    Retry failed
                  </button>
                )}
                <button
                  className="button button-secondary"
                  onClick={() =>
                    document
                      .getElementById("recent-analyses")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  View Recent Analyses
                </button>
                {onNavigateToCampaignTrends && (
                  <button
                    className="button button-primary"
                    onClick={onNavigateToCampaignTrends}
                  >
                    View Campaign Trends
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === "complete" && failureGroups.length > 0 && (
            <div className="batch-failure-summary" role="alert">
              <strong>Files that need attention</strong>
              <ul>
                {failureGroups.map(({ message, count }) => (
                  <li key={message}>
                    {count} {count === 1 ? "file" : "files"}: {message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {items.length > 0 && (
            <>
              <div className="batch-analysis-toolbar">
                <label>
                  Status
                  <select
                    value={filter}
                    onChange={(event) =>
                      setFilter(event.target.value as "all" | BatchStatus)
                    }
                  >
                    <option value="all">All files ({items.length})</option>
                    <option value="queued">Queued ({counts.queued})</option>
                    <option value="completed">
                      Completed ({counts.completed})
                    </option>
                    <option value="already_analyzed">
                      Already analyzed ({counts.known})
                    </option>
                    <option value="failed">Failed ({counts.failed})</option>
                    <option value="invalid">Invalid ({counts.invalid})</option>
                  </select>
                </label>
                <div className="batch-analysis-toolbar-actions">
                  {(phase === "review" || phase === "complete") &&
                    counts.queued > 0 &&
                    !preflightError && (
                      <button className="button button-primary" onClick={start}>
                        Analyze {counts.queued} new{" "}
                        {counts.queued === 1 ? "save" : "saves"}
                      </button>
                    )}
                  {phase === "running" && counts.queued > 0 && (
                    <button
                      className="button button-secondary"
                      onClick={cancel}
                    >
                      Cancel remaining
                    </button>
                  )}
                </div>
              </div>
              <div
                className="batch-analysis-list"
                tabIndex={0}
                aria-label="Batch save files"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Save</th>
                      <th>Size</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => {
                      const copy = STATUS_COPY[item.status];
                      return (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.file.name}</strong>
                            {item.gameDate && <span>{item.gameDate}</span>}
                          </td>
                          <td className="num">{bytes(item.file.size)}</td>
                          <td>
                            <span
                              className={`batch-status batch-status-${item.status}`}
                            >
                              <span aria-hidden="true">{copy.symbol}</span>{" "}
                              {copy.label}
                            </span>
                            {item.error && <small>{item.error}</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
});
