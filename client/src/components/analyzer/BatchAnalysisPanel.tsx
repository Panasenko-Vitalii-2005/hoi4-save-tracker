import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  analyzerUnavailableMessage,
  analysisError,
} from "@/lib/analysis-error";
import { apiFetch } from "@/lib/api-client";
import { useAppTranslation } from "@/i18n";
import {
  filterSnapshotFolderFiles,
  formatFileSize,
  sampleSnapshotFiles,
  type SnapshotSampleTarget,
  sortSnapshotFiles,
  totalFileSize,
} from "@/lib/snapshot-folder";

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
export const SNAPSHOTTER_DOWNLOAD_PATH =
  "/downloads/hoi4-save-snapshotter.ps1";
const STATUS_COPY = {
  identifying: { symbol: "…", labelKey: "batch.statuses.identifying" },
  already_analyzed: { symbol: "✓", labelKey: "batch.statuses.alreadyAnalyzed" },
  queued: { symbol: "○", labelKey: "batch.statuses.queued" },
  analyzing: { symbol: "→", labelKey: "batch.statuses.analyzing" },
  completed: { symbol: "✓", labelKey: "batch.statuses.completed" },
  failed: { symbol: "!", labelKey: "batch.statuses.failed" },
  invalid: { symbol: "!", labelKey: "batch.statuses.invalid" },
  duplicate: { symbol: "↷", labelKey: "batch.statuses.duplicate" },
  cancelled: { symbol: "–", labelKey: "batch.statuses.cancelled" },
};

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
  const { t, i18n } = useAppTranslation();
  const preflightUnavailable = t("analysis.errors.unavailable");
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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
  const [folderSelectionMade, setFolderSelectionMade] = useState(false);
  const [snapshotFiles, setSnapshotFiles] = useState<File[]>([]);
  const [sampleTarget, setSampleTarget] =
    useState<SnapshotSampleTarget>(25);

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
  const sampledSnapshotFiles = useMemo(
    () => sampleSnapshotFiles(snapshotFiles, sampleTarget),
    [sampleTarget, snapshotFiles],
  );
  const snapshotFolderSummary = useMemo(
    () => ({
      found: snapshotFiles.length,
      selected: sampledSnapshotFiles.length,
      skipped: snapshotFiles.length - sampledSnapshotFiles.length,
      selectedSize: totalFileSize(sampledSnapshotFiles),
      totalSize: totalFileSize(snapshotFiles),
    }),
    [sampledSnapshotFiles, snapshotFiles],
  );
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
        `${t("batch.selected")}: ${counts.selected}`,
        counts.known ? `${t("batch.alreadyAnalyzed")}: ${counts.known}` : "",
        `${t("batch.statuses.completed")}: ${counts.completed}`,
        `${t("batch.statuses.failed")}: ${counts.failed}`,
        counts.cancelled ? `${t("batch.statuses.cancelled")}: ${counts.cancelled}` : "",
        counts.invalid ? `${t("batch.invalid")}: ${counts.invalid}` : "",
        counts.duplicates ? `${t("batch.duplicates")}: ${counts.duplicates}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    [counts, t],
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
        response = await apiFetch("/api/analyze/batch/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hashes: chunk }),
        });
      } catch {
        throw new Error(analyzerUnavailableMessage());
      }
      if (!response.ok) throw new Error(preflightUnavailable);
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !Array.isArray((value as Record<string, unknown>).knownHashes)
      )
        throw new Error(preflightUnavailable);
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
    setFolderSelectionMade(false);
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
        ? t("analysis.errors.UNSUPPORTED_FILE_TYPE")
        : file.size === 0
          ? t("analysis.errors.EMPTY_FILE")
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
          item.error = t("analysis.errors.fileRead");
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
          error.message === analyzerUnavailableMessage()
          ? error.message
          : preflightUnavailable,
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
          error.message === analyzerUnavailableMessage()
          ? error.message
          : preflightUnavailable,
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
        let failureMessage = analyzerUnavailableMessage();
        try {
          const formData = new FormData();
          formData.append("file", item.file);
          const response = await apiFetch("/api/analyze?response=batch", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            const safe = await analysisError(response);
            failureMessage = safe.msg;
            throw new Error(safe.msg);
          }
          failureMessage =
            t("analysis.responseUnreadable");
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
          <span className="batch-analysis-eyebrow">{t("batch.eyebrow")}</span>
          <h2 id="batch-analysis-title">{t("batch.title")}</h2>
          <p>{t("batch.body")}</p>
        </div>
        <div className="batch-analysis-source-actions">
          <button
            className="button button-secondary"
            disabled={disabled || phase === "running" || phase === "identifying"}
            onClick={() => inputRef.current?.click()}
          >
            {t("analysis.importCampaign")}
          </button>
          <button
            className="button button-secondary"
            disabled={disabled || phase === "running" || phase === "identifying"}
            onClick={() => folderInputRef.current?.click()}
          >
            {t("batch.selectSnapshotFolder")}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".hoi4"
          multiple
          hidden
          aria-label={t("batch.title")}
          disabled={disabled || phase === "running"}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            if (selected.length) void prepare(selected);
            event.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept=".hoi4"
          multiple
          hidden
          aria-label={t("batch.snapshotFolderPickerAria")}
          disabled={disabled || phase === "running"}
          {...({ webkitdirectory: "" } as Record<string, string>)}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            if (selected.length) {
              updateItems([]);
              setPhase("idle");
              setPreflightError("");
              setFilter("all");
              setSnapshotFiles(
                sortSnapshotFiles(filterSnapshotFolderFiles(selected)),
              );
              setSampleTarget(25);
              setFolderSelectionMade(true);
            }
            event.target.value = "";
          }}
        />
      </div>

      <aside
        className="snapshotter-onboarding"
        aria-labelledby="snapshotter-onboarding-title"
      >
        <div className="snapshotter-onboarding-intro">
          <div>
            <span className="batch-analysis-eyebrow">
              {t("batch.snapshotter.eyebrow")}
            </span>
            <h3 id="snapshotter-onboarding-title">
              {t("batch.snapshotter.title")}
            </h3>
            <p>{t("batch.snapshotter.explanation")}</p>
          </div>
          <a
            className="button button-secondary"
            href={SNAPSHOTTER_DOWNLOAD_PATH}
            download="hoi4-save-snapshotter.ps1"
          >
            {t("batch.snapshotter.download")}
          </a>
        </div>
        <details className="snapshotter-quick-start">
          <summary>{t("batch.snapshotter.howToUse")}</summary>
          <div className="snapshotter-quick-start-body">
            <ol>
              <li>{t("batch.snapshotter.steps.download")}</li>
              <li>{t("batch.snapshotter.steps.openPowerShell")}</li>
              <li>{t("batch.snapshotter.steps.findSaveFolder")}</li>
              <li>{t("batch.snapshotter.steps.chooseOutput")}</li>
              <li>{t("batch.snapshotter.steps.start")}</li>
              <li>{t("batch.snapshotter.steps.keepRunning")}</li>
              <li>{t("batch.snapshotter.steps.return")}</li>
            </ol>
            <pre aria-label={t("batch.snapshotter.commandAria")}>
              <code>{`.\\hoi4-save-snapshotter.ps1 \`
  -SourceDir "C:\\Path\\To\\Hearts of Iron IV\\save games" \`
  -OutputDir "C:\\HoI4Snapshots" \`
  -Patterns "autosave_temp.hoi4"`}</code>
            </pre>
            <p>{t("batch.snapshotter.pathNote")}</p>
            <p>{t("batch.snapshotter.powerShellNote")}</p>
            <code className="snapshotter-unblock-command">
              Unblock-File .\hoi4-save-snapshotter.ps1
            </code>
            <p>{t("batch.snapshotter.workflow")}</p>
          </div>
        </details>
      </aside>

      {folderSelectionMade && (
        <div className="snapshot-folder-review" aria-live="polite">
          {snapshotFiles.length === 0 ? (
            <p className="snapshot-folder-empty">{t("batch.noSnapshotsFound")}</p>
          ) : (
            <>
              <div className="snapshot-folder-controls">
                <label>
                  <span>{t("batch.sampleDensity")}</span>
                  <select
                    value={sampleTarget}
                    onChange={(event) =>
                      setSampleTarget(
                        event.target.value === "all"
                          ? "all"
                          : (Number(event.target.value) as SnapshotSampleTarget),
                      )
                    }
                  >
                    <option value={10}>10</option>
                    <option value={25}>
                      25 — {t("batch.recommended")}
                    </option>
                    <option value={50}>50</option>
                    <option value="all">{t("batch.allSnapshots")}</option>
                  </select>
                </label>
                <button
                  className="button button-primary"
                  onClick={() => void prepare(sampledSnapshotFiles)}
                >
                  {t("batch.useSelectedSnapshots")}
                </button>
              </div>
              <dl className="snapshot-folder-summary">
                <div>
                  <dt>{t("batch.snapshotsFound")}</dt>
                  <dd>{snapshotFolderSummary.found}</dd>
                </div>
                <div>
                  <dt>{t("batch.snapshotsSelected")}</dt>
                  <dd>{snapshotFolderSummary.selected}</dd>
                </div>
                <div>
                  <dt>{t("batch.snapshotsSkipped")}</dt>
                  <dd>{snapshotFolderSummary.skipped}</dd>
                </div>
                <div>
                  <dt>{t("batch.selectedUploadSize")}</dt>
                  <dd>
                    {formatFileSize(
                      snapshotFolderSummary.selectedSize,
                      i18n.resolvedLanguage ?? i18n.language,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("batch.totalSnapshotSize")}</dt>
                  <dd>
                    {formatFileSize(
                      snapshotFolderSummary.totalSize,
                      i18n.resolvedLanguage ?? i18n.language,
                    )}
                  </dd>
                </div>
              </dl>
              <p className="snapshot-folder-note">
                {t("batch.snapshotSamplingNote")}
              </p>
            </>
          )}
        </div>
      )}

      {phase === "idle" ? (
        folderSelectionMade ? null : (
          <div className="batch-analysis-drop-hint">
            {t("batch.body")}
          </div>
        )
      ) : (
        <>
          <div className="batch-analysis-summary" aria-live="polite">
            <div>
              <strong>{counts.selected}</strong>
              <span>{t("batch.selected")}</span>
            </div>
            <div>
              <strong>{counts.known}</strong>
              <span>{t("batch.alreadyAnalyzed")}</span>
            </div>
            <div>
              <strong>{counts.queued}</strong>
              <span>{t("batch.new")}</span>
            </div>
            <div>
              <strong>{counts.invalid}</strong>
              <span>{t("batch.invalid")}</span>
            </div>
            <div>
              <strong>{counts.duplicates}</strong>
              <span>{t("batch.duplicates")}</span>
            </div>
          </div>

          {phase === "identifying" && (
            <div className="batch-analysis-progress" role="status">
              <span className="spinner" aria-hidden="true" />
              {t("batch.analyzing")} {identifyProgress.done} /{" "}
              {identifyProgress.total}…
            </div>
          )}

          {phase === "running" && (
            <div className="batch-analysis-progress" role="status">
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>{t("batch.analyzing")}</strong>
                <span>
                  {t("batch.processed", { processed, total: items.length })}
                </span>
                {current && <span>{t("batch.current", { name: current.file.name })}</span>}
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
                {t("common.retry")}
              </button>
            </div>
          )}

          {phase === "complete" && (
            <div className="batch-analysis-complete" role="status">
              <div>
                <strong>{t("batch.complete")}</strong>
                <span>{completionSummary}</span>
              </div>
              <div className="batch-analysis-actions">
                {counts.failed > 0 && (
                  <button
                    className="button button-secondary"
                    onClick={retryFailed}
                  >
                    {t("batch.retryFailed")}
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
                  {t("batch.viewRecent")}
                </button>
                {onNavigateToCampaignTrends && (
                  <button
                    className="button button-primary"
                    onClick={onNavigateToCampaignTrends}
                  >
                    {t("batch.viewTrends")}
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === "complete" && failureGroups.length > 0 && (
            <div className="batch-failure-summary" role="alert">
              <strong>{t("batch.attention")}</strong>
              <ul>
                {failureGroups.map(({ message, count }) => (
                  <li key={message}>
                    {t("batch.files", { count })}: {message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {items.length > 0 && (
            <>
              <div className="batch-analysis-toolbar">
                <label>
                  {t("batch.status")}
                  <select
                    value={filter}
                    onChange={(event) =>
                      setFilter(event.target.value as "all" | BatchStatus)
                    }
                  >
                    <option value="all">{t("batch.allFiles", { count: items.length })}</option>
                    <option value="queued">{t("batch.queuedCount", { count: counts.queued })}</option>
                    <option value="completed">
                      {t("batch.completedCount", { count: counts.completed })}
                    </option>
                    <option value="already_analyzed">
                      {t("batch.knownCount", { count: counts.known })}
                    </option>
                    <option value="failed">{t("batch.failedCount", { count: counts.failed })}</option>
                    <option value="invalid">{t("batch.invalidCount", { count: counts.invalid })}</option>
                  </select>
                </label>
                <div className="batch-analysis-toolbar-actions">
                  {(phase === "review" || phase === "complete") &&
                    counts.queued > 0 &&
                    !preflightError && (
                      <button className="button button-primary" onClick={start}>
                        {t("batch.analyzeNew", { count: counts.queued })}
                      </button>
                    )}
                  {phase === "running" && counts.queued > 0 && (
                    <button
                      className="button button-secondary"
                      onClick={cancel}
                    >
                      {t("batch.cancelRemaining")}
                    </button>
                  )}
                </div>
              </div>
              <div
                className="batch-analysis-list"
                tabIndex={0}
                aria-label={t("batch.listAria")}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{t("batch.save")}</th>
                      <th>{t("batch.size")}</th>
                      <th>{t("batch.status")}</th>
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
                          <td className="num">
                            {formatFileSize(
                              item.file.size,
                              i18n.resolvedLanguage ?? i18n.language,
                            )}
                          </td>
                          <td>
                            <span
                              className={`batch-status batch-status-${item.status}`}
                            >
                              <span aria-hidden="true">{copy.symbol}</span>{" "}
                              {t(copy.labelKey)}
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
