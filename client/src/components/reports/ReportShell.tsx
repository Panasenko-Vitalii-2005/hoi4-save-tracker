import type { ReactNode } from "react";
import { ExportControls } from "@/components/ui/ExportControls";
import { useAppTranslation } from "@/i18n";

interface ReportFile {
  content: string;
  filename: string;
}

export function ReportShell({
  eyebrow,
  title,
  subtitle,
  metadata,
  onBack,
  createCsv,
  createJson,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  metadata?: ReactNode;
  onBack: () => void;
  createCsv: () => ReportFile;
  createJson: () => ReportFile;
  children: ReactNode;
}) {
  const { t } = useAppTranslation();
  return (
    <main className="analysis-report" aria-labelledby="report-title">
      <header className="report-header">
        <div className="report-heading-copy">
          <span className="eyebrow">{eyebrow}</span>
          <h1 id="report-title">{title}</h1>
          <p>{subtitle}</p>
          {metadata && <div className="report-header-meta">{metadata}</div>}
        </div>
        <div className="report-actions" aria-label={t("report.actions")}>
          <button
            type="button"
            className="button button-secondary"
            onClick={onBack}
          >
            ← {t("report.back")}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => window.print()}
          >
            {t("report.print")}
          </button>
          <ExportControls
            label={t("report.export")}
            createCsv={createCsv}
            createJson={createJson}
          />
        </div>
      </header>
      <div className="report-body">{children}</div>
      <footer className="report-footer">
        {t("report.footer")}
      </footer>
    </main>
  );
}
export function ReportMetric({
  label,
  value,
  exact,
}: {
  label: string;
  value: string;
  exact?: string;
}) {
  const { t } = useAppTranslation();
  return (
    <article className="report-metric">
      <span>{label}</span>
      <strong title={exact}>{value}</strong>
      {exact && exact !== value && <small>{t("report.exact", { value: exact })}</small>}
    </article>
  );
}
