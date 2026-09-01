const MESSAGES: Record<string, string> = {
  EMPTY_FILE: "The uploaded save is empty. Choose another .hoi4 file.",
  UNSUPPORTED_FILE_TYPE: "Choose a Hearts of Iron IV .hoi4 save file.",
  INVALID_SAVE:
    "This is not a valid Hearts of Iron IV save, or the file is incomplete.",
  CORRUPT_ARCHIVE:
    "This compressed save appears to be corrupted or incomplete.",
  UNSUPPORTED_SAVE:
    "This HoI4 save could not be analyzed. It may use an unsupported game version or mod configuration.",
  DECOMPRESSED_SIZE_LIMIT:
    "The uncompressed save is too large to analyze within the current server limit.",
  UPLOAD_TIMEOUT: "The upload took too long and was stopped. Please try again.",
  ANALYSIS_TIMEOUT: "Analysis took too long and was stopped.",
  ANALYZER_BUSY:
    "The analyzer is busy with another save. Please try again in a few seconds.",
  PERSISTENCE_FAILED:
    "The analysis completed but could not be saved. Check server storage and retry.",
  ANALYSIS_FAILED: "Could not analyze the save. Please try again.",
  SAVE_NOT_FOUND:
    "The selected save is no longer available. Refresh the list or upload it again.",
};

export async function analysisError(
  response: Response,
): Promise<{ type: "error" | "busy"; msg: string }> {
  // Only allowlisted codes/numeric limits are consumed. Never render server messages/stacks.
  const body: unknown = await response.json().catch(() => null);
  const data =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof data.code === "string" ? data.code : "";
  if (code === "FILE_TOO_LARGE") {
    const limit = data.maxUploadBytes;
    return {
      type: "error",
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
    };
  if (response.status === 503)
    return { type: "busy", msg: MESSAGES.ANALYZER_BUSY };
  if (response.status === 413)
    return {
      type: "error",
      msg: "This save is too large to upload. Please choose a smaller file.",
    };
  if (response.status === 404)
    return { type: "error", msg: MESSAGES.SAVE_NOT_FOUND };
  return { type: "error", msg: MESSAGES.ANALYSIS_FAILED };
}
