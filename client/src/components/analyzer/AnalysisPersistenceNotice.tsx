import { useAppTranslation } from "@/i18n";
import type { AnalysisPersistence } from "@/lib/analysis-persistence";

export function AnalysisPersistenceNotice({
  outcome,
  onRetry,
  disabled,
}: {
  outcome: AnalysisPersistence;
  onRetry?: () => void;
  disabled: boolean;
}) {
  const { t } = useAppTranslation();
  return (
    <div
      className={`recovery-notice analysis-persistence-notice ${outcome}`}
      role="status"
      aria-live="polite"
    >
      <div>
        <strong>{t(`analysis.persistence.${outcome}`)}</strong>
        {outcome !== "saved" && (
          <span>{t("analysis.persistence.recovery")}</span>
        )}
      </div>
      {outcome !== "saved" && onRetry && (
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled}
          onClick={onRetry}
        >
          {t("analysis.persistence.retry")}
        </button>
      )}
    </div>
  );
}
