import type { ReactNode } from "react";
import { ExportControls } from "@/components/ui/ExportControls";

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
  return (
    <main className="analysis-report" aria-labelledby="report-title">
      <header className="report-header">
        <div className="report-heading-copy">
          <span className="eyebrow">{eyebrow}</span>
          <h1 id="report-title">{title}</h1>
          <p>{subtitle}</p>
          {metadata && <div className="report-header-meta">{metadata}</div>}
        </div>
        <div className="report-actions" aria-label="Report actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onBack}
          >
            ← Back
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => window.print()}
          >
            Print
          </button>
          <ExportControls
            label="Export report data"
            createCsv={createCsv}
            createJson={createJson}
          />
        </div>
      </header>
      <div className="report-body">{children}</div>
      <footer className="report-footer">
        Generated from stored HOI4 save-analysis data. Missing values remain
        unavailable rather than being treated as zero.
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
  return (
    <article className="report-metric">
      <span>{label}</span>
      <strong title={exact}>{value}</strong>
      {exact && exact !== value && <small>Exact: {exact}</small>}
    </article>
  );
}
