import { useState } from "react";
import { downloadTextFile } from "@/lib/data-export";

interface ExportFile {
  content: string;
  filename: string;
}

export function ExportControls({
  label,
  createCsv,
  createJson,
}: {
  label: string;
  createCsv: () => ExportFile;
  createJson: () => ExportFile;
}) {
  const [error, setError] = useState("");

  const download = (format: "csv" | "json") => {
    setError("");
    try {
      const file = format === "csv" ? createCsv() : createJson();
      downloadTextFile(
        file.content,
        file.filename,
        format === "csv" ? "text/csv" : "application/json",
      );
    } catch {
      setError("Export could not be created. Please try again.");
    }
  };

  return (
    <div className="export-controls" aria-label={label}>
      <span>Export</span>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => download("csv")}
      >
        CSV
      </button>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => download("json")}
      >
        JSON
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
