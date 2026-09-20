import { useEffect, useRef, useState } from "react";
import type { RecentAnalysis } from "@/types";
import { apiFetch } from "@/lib/api-client";
import { trackAnalysisEvent } from "@/lib/product-telemetry";
import { useAppTranslation } from "@/i18n";

export interface PublicShareLink {
  id: string;
  path: string;
}

const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;

function publicUrl(link: PublicShareLink): string {
  return new URL(`/share/${link.id}`, window.location.origin).toString();
}

export function ShareAnalysisDialog({
  item,
  initialLink,
  onClose,
  onCreated,
  onRevoked,
}: {
  item: RecentAnalysis;
  initialLink?: PublicShareLink;
  onClose: () => void;
  onCreated: (link: PublicShareLink) => void;
  onRevoked: () => void;
}) {
  const { t } = useAppTranslation();
  const [link, setLink] = useState<PublicShareLink | null>(
    initialLink ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const primaryAction = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryAction.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch(
        `/api/analyze/recent/${encodeURIComponent(item.hash)}/share`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Share unavailable");
      const value = (await response.json()) as Partial<PublicShareLink>;
      if (
        typeof value.id !== "string" ||
        !PUBLIC_ID.test(value.id) ||
        value.path !== `/share/${value.id}`
      )
        throw new Error("Invalid share response");
      const created = { id: value.id, path: value.path };
      setLink(created);
      onCreated(created);
      void trackAnalysisEvent("analysis_shared", item.hash);
      setMessage(t("share.created"));
    } catch {
      setMessage(t("share.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link || busy) return;
    try {
      await navigator.clipboard.writeText(publicUrl(link));
      setMessage(t("share.copiedStatus"));
    } catch {
      setMessage(t("share.copyFailed"));
    }
  };

  const revoke = async () => {
    if (
      !link ||
      busy ||
      !window.confirm(
        t("share.revokeConfirm"),
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const response = await apiFetch(
        `/api/analyze/recent/${encodeURIComponent(item.hash)}/share`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Revoke unavailable");
      setLink(null);
      onRevoked();
      setMessage(t("share.revoked"));
    } catch {
      setMessage(t("share.revokeFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-dialog-backdrop" role="presentation">
      <section
        className="panel share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-analysis-title"
        aria-describedby="share-analysis-description"
        aria-busy={busy}
      >
        <div className="panel-head">
          <h2 id="share-analysis-title">{t("share.title")}</h2>
          <button
            className="button button-secondary"
            onClick={onClose}
            disabled={busy}
            aria-label={t("share.close")}
          >
            {t("common.close")}
          </button>
        </div>
        {!link && message !== t("share.revoked") ? (
          <>
            <p id="share-analysis-description">
              {t("share.createBody")}
            </p>
            <p className="micro-copy">
              {t("share.privacy")}
            </p>
            <div className="share-dialog-actions">
              <button
                className="button button-secondary"
                onClick={onClose}
                disabled={busy}
              >
                {t("common.cancel")}
              </button>
              <button
                ref={primaryAction}
                className="button button-primary"
                onClick={() => void create()}
                disabled={busy}
              >
                {busy ? t("share.creating") : t("share.create")}
              </button>
            </div>
          </>
        ) : link ? (
          <>
            <p id="share-analysis-description">
              {t("share.linkBody")}
            </p>
            <label className="share-dialog-url" htmlFor="public-share-url">
              {t("share.publicUrl")}
              <input
                id="public-share-url"
                value={publicUrl(link)}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <div className="share-dialog-actions">
              <button
                ref={primaryAction}
                className="button button-secondary"
                onClick={() => void copy()}
                disabled={busy}
              >
                {t("share.copy")}
              </button>
              <a
                className="button button-secondary share-dialog-open"
                href={link.path}
                target="_blank"
                rel="noreferrer"
              >
                {t("share.openPublic")}
              </a>
              <button
                className="button button-secondary analyzer-recent-delete"
                onClick={() => void revoke()}
                disabled={busy}
              >
                {busy ? t("share.revoking") : t("share.revoke")}
              </button>
            </div>
          </>
        ) : (
          <p id="share-analysis-description">{t("share.revoked")}</p>
        )}
        <div className="micro-copy" role="status" aria-live="polite">
          {message}
        </div>
      </section>
    </div>
  );
}
