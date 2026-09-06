import { useEffect, useMemo, useRef, useState } from "react";
import { formatCountryDisplayName } from "@/lib/countryNames";
import { apiFetch } from "@/lib/api-client";
import type {
  AnalysisStorageCampaign,
  AnalysisStorageMutationResult,
  AnalysisStorageStatus,
  RecentAnalysis,
} from "@/types";

type CleanupAction =
  | { kind: "campaign"; campaign: AnalysisStorageCampaign }
  | { kind: "unpinned" };

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: index === 0 ? 0 : 1,
  })} ${units[index]}`;
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

function campaignName(campaign: AnalysisStorageCampaign): string {
  return campaign.playerCountryTag
    ? formatCountryDisplayName(campaign.playerCountryTag)
    : "Known campaign";
}

function campaignRange(campaign: AnalysisStorageCampaign): string {
  if (campaign.firstGameDate && campaign.latestGameDate)
    return `${campaign.firstGameDate} → ${campaign.latestGameDate}`;
  return (
    campaign.firstGameDate ?? campaign.latestGameDate ?? "Date unavailable"
  );
}

function validStatus(value: unknown): value is AnalysisStorageStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  return (
    [
      "recentAnalysisCount",
      "persistedAnalysisCount",
      "persistedResultBytes",
      "maxPersistedResultBytes",
      "knownCampaignCount",
      "unknownCampaignAnalysisCount",
      "pinnedAnalysisCount",
      "unpinnedAnalysisCount",
      "sharedAnalysisCount",
      "cleanupEligibleCount",
    ].every(
      (key) =>
        typeof status[key] === "number" &&
        Number.isSafeInteger(status[key]) &&
        status[key] >= 0,
    ) &&
    status.storageAccounting === "owned_logical_artifacts" &&
    status.storageLimitScope === "global_physical_artifacts" &&
    typeof status.shareStatusReliable === "boolean" &&
    Array.isArray(status.campaigns)
  );
}

function validMutation(value: unknown): value is AnalysisStorageMutationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.deletedCount === "number" &&
    Number.isSafeInteger(result.deletedCount) &&
    result.deletedCount >= 0 &&
    Array.isArray(result.items) &&
    validStatus(result.storage)
  );
}

function StorageConfirmationDialog({
  action,
  status,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: CleanupAction;
  status: AnalysisStorageStatus;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (includePinned: boolean) => void;
}) {
  const [acknowledgedPins, setAcknowledgedPins] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const campaign = action.kind === "campaign" ? action.campaign : null;
  const pinned = campaign?.pinnedAnalysisCount ?? 0;
  const shared =
    action.kind === "campaign"
      ? action.campaign.sharedAnalysisCount
      : status.sharedAnalysisCount;
  const count =
    action.kind === "campaign"
      ? action.campaign.analysisCount
      : status.cleanupEligibleCount;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancel.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onCancel]);

  return (
    <div className="share-dialog-backdrop" role="presentation">
      <section
        className="panel storage-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="storage-confirm-title"
        aria-describedby="storage-confirm-description"
        aria-busy={busy}
      >
        <h2 id="storage-confirm-title">
          {action.kind === "campaign"
            ? "Delete campaign analyses?"
            : "Delete all unpinned analyses?"}
        </h2>
        {campaign && (
          <div className="storage-confirm-campaign">
            <strong>{campaignName(campaign)}</strong>
            <span>{campaignRange(campaign)}</span>
            <span>
              {countLabel(campaign.analysisCount, "analysis", "analyses")}
            </span>
          </div>
        )}
        <p id="storage-confirm-description">
          This removes {countLabel(count, "stored analysis", "stored analyses")}{" "}
          from Recent Analyses. It does not remove your original .hoi4 save
          files.
        </p>
        {action.kind === "unpinned" && (
          <p className="micro-copy">
            {countLabel(
              status.pinnedAnalysisCount,
              "pinned analysis",
              "pinned analyses",
            )}{" "}
            will remain protected.
          </p>
        )}
        {shared > 0 && status.shareStatusReliable && (
          <p className="micro-copy">
            {countLabel(shared, "active public link", "active public links")}{" "}
            will remain available. Their shared result files stay stored until
            the links are revoked.
          </p>
        )}
        {!status.shareStatusReliable && (
          <p className="micro-copy">
            Public-link status is unavailable. Protected shared result files may
            remain stored.
          </p>
        )}
        {pinned > 0 && (
          <label className="storage-pin-acknowledgement">
            <input
              type="checkbox"
              checked={acknowledgedPins}
              onChange={(event) => setAcknowledgedPins(event.target.checked)}
            />
            <span>
              I understand this also removes{" "}
              {countLabel(pinned, "pinned analysis", "pinned analyses")}.
            </span>
          </label>
        )}
        {error && (
          <div className="recovery-notice" role="alert">
            <div>
              <strong>Cleanup failed</strong>
              <span>{error}</span>
            </div>
          </div>
        )}
        <div className="storage-confirm-actions">
          <button
            ref={cancel}
            className="button button-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="button analyzer-storage-destructive"
            onClick={() => onConfirm(pinned > 0)}
            disabled={busy || (pinned > 0 && !acknowledgedPins)}
          >
            {busy ? "Deleting…" : "Delete stored analyses"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AnalysisStorageManagement({
  items,
  refreshVersion,
  disabled,
  onBusyChange,
  onChanged,
}: {
  items: readonly RecentAnalysis[];
  refreshVersion: number;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged: (items: RecentAnalysis[], message: string) => void;
}) {
  const [status, setStatus] = useState<AnalysisStorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [action, setAction] = useState<CleanupAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const itemKey = useMemo(
    () => items.map((item) => `${item.hash}:${Number(item.pinned)}`).join("|"),
    [items],
  );

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    void (async () => {
      try {
        const response = await apiFetch("/api/analyze/storage", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Storage unavailable");
        const value: unknown = await response.json();
        if (!validStatus(value)) throw new Error("Invalid storage response");
        if (active) setStatus(value);
      } catch {
        if (active)
          setLoadError(
            "Local storage information could not be loaded. Please try again.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [itemKey, refreshVersion, retry]);

  useEffect(() => {
    if (!status?.campaigns.length) {
      setSelectedCampaign("");
      return;
    }
    if (
      !status.campaigns.some((entry) => entry.campaignId === selectedCampaign)
    )
      setSelectedCampaign(status.campaigns[0].campaignId);
  }, [selectedCampaign, status]);

  const execute = async (includePinned: boolean) => {
    if (!action || !status || busy) return;
    setBusy(true);
    setActionError("");
    onBusyChange(true);
    try {
      const response = await apiFetch(
        action.kind === "campaign"
          ? `/api/analyze/storage/campaign/${encodeURIComponent(action.campaign.campaignId)}`
          : "/api/analyze/storage/unpinned",
        action.kind === "campaign"
          ? {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ includePinned }),
            }
          : { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Cleanup unavailable");
      const value: unknown = await response.json();
      if (!validMutation(value)) throw new Error("Invalid cleanup response");
      setStatus(value.storage);
      setAction(null);
      onChanged(
        value.items,
        `${countLabel(value.deletedCount, "saved analysis", "saved analyses")} deleted.`,
      );
    } catch {
      setActionError(
        "Stored analyses could not be deleted. Your visible data has been kept; retry when storage is available.",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  const selected = status?.campaigns.find(
    (campaign) => campaign.campaignId === selectedCampaign,
  );

  if (!loading && !status && !loadError) return null;
  return (
    <section className="analyzer-storage" aria-label="Your saved analyses">
      <div className="analyzer-storage-summary">
        <div>
          <strong>Your saved analyses</strong>
          {status ? (
            <span>
              {countLabel(status.persistedAnalysisCount, "stored result")} ·{" "}
              {countLabel(status.knownCampaignCount, "known campaign")}
            </span>
          ) : (
            <span>
              {loading ? "Checking storage…" : "Storage status unavailable"}
            </span>
          )}
        </div>
        {status && (
          <div className="analyzer-storage-usage">
            <span>
              {formatBytes(status.persistedResultBytes)} logical result data
            </span>
            <span className="micro-copy">
              Shared artifact-store limit:{" "}
              {formatBytes(status.maxPersistedResultBytes)}
            </span>
          </div>
        )}
      </div>
      <p className="micro-copy analyzer-storage-copy">
        Uploaded .hoi4 files are processed temporarily and are not retained
        here. Derived analysis results and Recent metadata are stored locally;
        deleting a result means analyzing the original save again to reopen it.
      </p>
      {loadError && (
        <div className="recovery-notice" role="alert">
          <div>
            <strong>Storage status unavailable</strong>
            <span>{loadError}</span>
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
      {status &&
        (status.cleanupEligibleCount > 0 || status.campaigns.length > 0) && (
          <details className="analyzer-storage-management">
            <summary>Manage storage</summary>
            <div className="analyzer-storage-controls">
              {status.campaigns.length > 0 && (
                <label htmlFor="storage-campaign-select">
                  Known campaign
                  <select
                    id="storage-campaign-select"
                    value={selectedCampaign}
                    onChange={(event) =>
                      setSelectedCampaign(event.target.value)
                    }
                    disabled={disabled || busy}
                  >
                    {status.campaigns.map((campaign) => (
                      <option
                        key={campaign.campaignId}
                        value={campaign.campaignId}
                      >
                        {campaignName(campaign)} · {campaignRange(campaign)} ·{" "}
                        {campaign.analysisCount.toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="analyzer-storage-actions">
                {selected && (
                  <button
                    className="button button-secondary analyzer-storage-destructive"
                    onClick={() => {
                      setActionError("");
                      setAction({ kind: "campaign", campaign: selected });
                    }}
                    disabled={disabled || busy}
                  >
                    Delete campaign
                  </button>
                )}
                {status.cleanupEligibleCount > 0 && (
                  <button
                    className="button button-secondary analyzer-storage-destructive"
                    onClick={() => {
                      setActionError("");
                      setAction({ kind: "unpinned" });
                    }}
                    disabled={disabled || busy}
                  >
                    Delete {status.cleanupEligibleCount.toLocaleString()}{" "}
                    unpinned
                  </button>
                )}
              </div>
              <p className="micro-copy">
                Pinned analyses are protected from unpinned cleanup. Removing an
                analysis revokes your access; its deduplicated result
                artifact may remain for another owner or an active public link.
              </p>
            </div>
          </details>
        )}
      {action && status && (
        <StorageConfirmationDialog
          action={action}
          status={status}
          busy={busy}
          error={actionError}
          onCancel={() => {
            if (!busy) {
              setAction(null);
              setActionError("");
            }
          }}
          onConfirm={(includePinned) => void execute(includePinned)}
        />
      )}
    </section>
  );
}
