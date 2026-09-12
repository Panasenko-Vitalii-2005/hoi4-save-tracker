const MESSAGES: Record<string, string> = {
  EMPTY_FILE: "The uploaded save is empty. Choose another .hoi4 file.",
  UNSUPPORTED_FILE_TYPE: "Choose a Hearts of Iron IV .hoi4 save file.",
  INVALID_SAVE:
    "This is not a valid Hearts of Iron IV save, or the file is incomplete.",
  CORRUPT_ARCHIVE:
    "This compressed save appears to be corrupted or incomplete.",
  UNSUPPORTED_SAVE:
    "This HoI4 save could not be analyzed. It may use an unsupported game version or mod configuration.",
  UNSUPPORTED_BINARY_SAVE:
    "Binary Hearts of Iron IV save detected. Binary saves are not supported yet. Set save_as_binary=no and create a new save.",
  DECOMPRESSED_SIZE_LIMIT:
    "The uncompressed save is too large to analyze within the current server limit.",
  UPLOAD_TIMEOUT: "The upload took too long and was stopped. Please try again.",
  ANALYSIS_TIMEOUT: "Analysis took too long and was stopped.",
  ANALYZER_BUSY:
    "The analyzer is busy with another save. Please try again in a few seconds.",
  PERSISTENCE_FAILED:
    "The analysis completed but could not be saved. Your previous result is safe; try again.",
  ANALYSIS_FAILED: "Could not analyze the save. Please try again.",
  SAVE_NOT_FOUND:
    "The selected save is no longer available. Refresh the list or upload it again.",
};

export const ANALYZER_UNAVAILABLE_MESSAGE =
  "Cannot reach the analyzer service. Check that the application is running and try again.";

export type AnalysisFailure = {
  type: "error" | "busy";
  msg: string;
  recovery: "retry" | "choose-file";
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
        "This save is too large to analyze." +
        (typeof limit === "number" &&
        Number.isSafeInteger(limit) &&
        limit > 0 &&
        limit <= 0x7fffffff
          ? ` Maximum upload size: ${(limit / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 })} MiB.`
          : ""),
    };
  }
  if (Object.hasOwn(MESSAGES, code))
    return {
      type: code === "ANALYZER_BUSY" ? "busy" : "error",
      msg: MESSAGES[code],
      recovery: CHOOSE_ANOTHER_FILE.has(code) ? "choose-file" : "retry",
    };
  if (response.status === 503)
    return {
      type: "busy",
      msg: MESSAGES.ANALYZER_BUSY,
      recovery: "retry",
    };
  if (response.status === 413)
    return {
      type: "error",
      msg: "This save is too large to upload. Please choose a smaller file.",
      recovery: "choose-file",
    };
  if (response.status === 404)
    return {
      type: "error",
      msg: MESSAGES.SAVE_NOT_FOUND,
      recovery: "choose-file",
    };
  return {
    type: "error",
    msg: MESSAGES.ANALYSIS_FAILED,
    recovery: "retry",
  };
}

export function analysisNetworkError(): AnalysisFailure {
  return {
    type: "error",
    msg: ANALYZER_UNAVAILABLE_MESSAGE,
    recovery: "retry",
  };
}

export function analysisFileReadError(): AnalysisFailure {
  return {
    type: "error",
    msg: "The selected save could not be read. Choose the file again and make sure it is still available.",
    recovery: "choose-file",
  };
}
