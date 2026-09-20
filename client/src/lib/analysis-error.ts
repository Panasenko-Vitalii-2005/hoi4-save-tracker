import { i18n } from "@/i18n";

const ERROR_CODES = new Set([
  "EMPTY_FILE", "UNSUPPORTED_FILE_TYPE", "INVALID_SAVE", "CORRUPT_ARCHIVE",
  "UNSUPPORTED_SAVE", "UNSUPPORTED_BINARY_SAVE", "DECOMPRESSED_SIZE_LIMIT",
  "UPLOAD_TIMEOUT", "ANALYSIS_TIMEOUT", "ANALYZER_BUSY", "PERSISTENCE_FAILED",
  "ANALYSIS_FAILED", "SAVE_NOT_FOUND",
]);

function message(code: string): string {
  return i18n.t(`analysis.errors.${code}`);
}

export function analyzerUnavailableMessage(): string {
  return i18n.t("analysis.errors.unavailable");
}

export type AnalysisFailure = {
  type: "error" | "busy";
  msg: string;
  recovery: "retry" | "choose-file";
  reason?: "unsupported-binary-save";
};

const CHOOSE_ANOTHER_FILE = new Set([
  "EMPTY_FILE",
  "UNSUPPORTED_FILE_TYPE",
  "INVALID_SAVE",
  "CORRUPT_ARCHIVE",
  "UNSUPPORTED_SAVE",
  "UNSUPPORTED_BINARY_SAVE",
  "DECOMPRESSED_SIZE_LIMIT",
  "FILE_TOO_LARGE",
  "SAVE_NOT_FOUND",
]);

export async function analysisError(
  response: Response,
): Promise<AnalysisFailure> {
  // Only allowlisted codes/numeric limits are consumed. Never render server messages/stacks.
  const body: unknown = await response.json().catch(() => null);
  const data =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof data.code === "string" ? data.code : "";
  if (code === "FILE_TOO_LARGE") {
    const limit = data.maxUploadBytes;
    return {
      type: "error",
      recovery: "choose-file",
      msg:
        i18n.t("analysis.errors.tooLarge") +
        (typeof limit === "number" &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 0x7fffffff
          ? i18n.t("analysis.errors.maxUpload", { size: (limit / 1048576).toLocaleString(i18n.resolvedLanguage === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 2 }) })
          : ""),
    };
  }
  if (ERROR_CODES.has(code))
    return {
      type: code === "ANALYZER_BUSY" ? "busy" : "error",
      msg: message(code),
      recovery: CHOOSE_ANOTHER_FILE.has(code) ? "choose-file" : "retry",
      reason:
        code === "UNSUPPORTED_BINARY_SAVE"
          ? "unsupported-binary-save"
          : undefined,
    };
  if (response.status === 503)
    return {
      type: "busy",
      msg: message("ANALYZER_BUSY"),
      recovery: "retry",
    };
  if (response.status === 413)
    return {
      type: "error",
      msg: i18n.t("analysis.errors.tooLargeUpload"),
      recovery: "choose-file",
    };
  if (response.status === 404)
    return {
      type: "error",
      msg: message("SAVE_NOT_FOUND"),
      recovery: "choose-file",
    };
  return {
    type: "error",
    msg: message("ANALYSIS_FAILED"),
    recovery: "retry",
  };
}

export function analysisNetworkError(): AnalysisFailure {
  return {
    type: "error",
    msg: i18n.t("analysis.errors.unavailable"),
    recovery: "retry",
  };
}

export function analysisFileReadError(): AnalysisFailure {
  return {
    type: "error",
    msg: i18n.t("analysis.errors.fileRead"),
    recovery: "choose-file",
  };
}
