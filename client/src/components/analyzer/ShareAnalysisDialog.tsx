import { useEffect, useRef, useState } from "react";
import type { RecentAnalysis } from "@/types";

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
      const response = await fetch(
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
      setMessage("Public link created.");
    } catch {
      setMessage("Could not create the public link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link || busy) return;
    try {
      await navigator.clipboard.writeText(publicUrl(link));
      setMessage("Public link copied.");
    } catch {
      setMessage("Could not copy automatically. Select and copy the URL below.");
    }
  };

  const revoke = async () => {
    if (
      !link ||
      busy ||
      !window.confirm(
        "Revoke this public link? Anyone using it will no longer be able to open the shared analysis.",
      )
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/analyze/recent/${encodeURIComponent(item.hash)}/share`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Revoke unavailable");
      setLink(null);
      onRevoked();
      setMessage("Public link revoked.");
    } catch {
      setMessage("Could not revoke the public link. Please try again.");
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
          <h2 id="share-analysis-title">Share analysis</h2>
          <button
            className="button button-secondary"
            onClick={onClose}
            disabled={busy}
            aria-label="Close share dialog"
          >
            Close
          </button>
        </div>
        {!link && message !== "Public link revoked." ? (
          <>
            <p id="share-analysis-description">
              Create a public, read-only link for this analysis? Anyone with the
              link can view the analyzed campaign data.
            </p>
            <p className="micro-copy">
              The original save file, private filename and Recent Analyses
              controls are not shared.
            </p>
            <div className="share-dialog-actions">
              <button
                className="button button-secondary"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                ref={primaryAction}
                className="button button-primary"
                onClick={() => void create()}
                disabled={busy}
              >
                {busy ? "Creating…" : "Create public link"}
              </button>
            </div>
          </>
        ) : link ? (
          <>
            <p id="share-analysis-description">
              Anyone with this link can open a read-only analysis view.
            </p>
            <label className="share-dialog-url" htmlFor="public-share-url">
              Public URL
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
                Copy link
              </button>
              <a
                className="button button-secondary share-dialog-open"
                href={link.path}
                target="_blank"
                rel="noreferrer"
              >
                Open public view
              </a>
              <button
                className="button button-secondary analyzer-recent-delete"
                onClick={() => void revoke()}
                disabled={busy}
              >
                {busy ? "Revoking…" : "Revoke link"}
              </button>
            </div>
          </>
        ) : (
          <p id="share-analysis-description">This public link is revoked.</p>
        )}
        <div className="micro-copy" role="status" aria-live="polite">
          {message}
        </div>
      </section>
    </div>
  );
}
