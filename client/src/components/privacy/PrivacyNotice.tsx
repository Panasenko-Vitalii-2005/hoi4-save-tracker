import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAppTranslation } from "@/i18n";
import "./PrivacyNotice.css";

/** Accessible before login and on public shares. Contact is public server config,
 * not a build-time frontend setting; no account email/path is sent. */
export function PrivacyNotice() {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const response = await apiFetch(
          "/api/privacy",
          {
            signal: controller.signal,
            cache: "no-store",
          },
          "public",
        );
        if (!response.ok) throw new Error("Contact unavailable");
        const body: unknown = await response.json();
        const value =
          body && typeof body === "object" && "supportEmail" in body
            ? body.supportEmail
            : null;
        if (active)
          setEmail(
            typeof value === "string" &&
              value.length <= 254 &&
              /^[^\s<>?@]+@[^\s<>?@]+\.[^\s<>?@]+$/.test(value)
              ? value
              : null,
          );
      } catch {
        if (active) setEmail(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, attempt]);
  return (
    <footer className="privacy-footer">
      <details
        className="panel privacy-notice"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>{t("privacy.title")}</summary>
        {open && (
          <div className="privacy-body">
            <p>{t("privacy.uploads")}</p>
            <p>{t("privacy.sharing")}</p>
            <p>{t("privacy.accountData")}</p>
            <p>{t("privacy.deletion")}</p>
            <p>{t("privacy.backups")}</p>
            <h2>{t("privacy.supportTitle")}</h2>
            <p>{t("privacy.supportScope")}</p>
            <p>{t("privacy.verification")}</p>
            {loading ? (
              <p role="status">{t("common.loading")}</p>
            ) : email ? (
              <a
                href={`mailto:${encodeURIComponent(email).replace(/%40/g, "@")}`}
              >
                {email}
              </a>
            ) : (
              <div>
                <p role="alert">{t("privacy.supportUnavailable")}</p>
                <button
                  className="button button-secondary"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  {t("common.retry")}
                </button>
              </div>
            )}
          </div>
        )}
      </details>
    </footer>
  );
}
