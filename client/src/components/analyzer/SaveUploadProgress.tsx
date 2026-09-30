import type { SaveUploadProgress as UploadMeasurement } from "@/lib/api-client";
import { formatFileSize } from "@/lib/snapshot-folder";
import { useAppTranslation } from "@/i18n";

export function SaveUploadProgress({
  progress,
}: {
  progress: UploadMeasurement | null;
}) {
  const { t, i18n } = useAppTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const percentage = progress?.total
    ? (progress.loaded / progress.total) * 100
    : null;
  return (
    <div className="save-upload-progress" aria-live="off">
      <div className="save-upload-measurements">
        <span>
          {progress
            ? progress.total !== null
              ? t("analysis.uploadProgress.bytes", {
                  uploaded: formatFileSize(progress.loaded, locale),
                  total: formatFileSize(progress.total, locale),
                })
              : t("analysis.uploadProgress.sent", {
                  size: formatFileSize(progress.loaded, locale),
                })
            : t("analysis.uploadProgress.waiting")}
        </span>
        {percentage !== null && (
          <strong>
            {new Intl.NumberFormat(locale, {
              maximumFractionDigits: 1,
            }).format(percentage)}%
          </strong>
        )}
      </div>
      <progress
        aria-label={t("analysis.uploadProgress.label")}
        max={progress?.total ?? 1}
        value={progress?.total ? progress.loaded : undefined}
      />
    </div>
  );
}
