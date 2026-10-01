// Transport only: never decode/re-encode save text or change its content identity.
export const GZIP_MIN_SOURCE_BYTES = 8 * 1024 * 1024;
export const GZIP_MIN_SAVED_BYTES = 64 * 1024;
export const GZIP_MAX_RETAINED_RATIO = 0.9;
export const GZIP_MAX_BLOB_BYTES = 32 * 1024 * 1024;

export function canPrepareSaveUpload(body: FormData): boolean {
  // Existing/prepared multipart contracts must not be rewritten or double-wrapped.
  for (const key of body.keys()) if (key !== "file") return false;
  const file = body.get("file");
  return (
    body.getAll("file").length === 1 && file instanceof File &&
    file.size >= GZIP_MIN_SOURCE_BYTES && typeof file.stream === "function" &&
    typeof CompressionStream === "function"
  );
}

export async function prepareSaveUpload(
  body: FormData,
  signal?: AbortSignal,
  onPreparing?: () => void,
): Promise<FormData> {
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException("Request aborted", "AbortError");
  };
  checkAbort();
  const file = body.get("file");
  if (!canPrepareSaveUpload(body) || !(file instanceof File)) return body;
  try {
    // Only this bounded prefix is buffered, not the whole source File.
    const prefix = new Uint8Array(await file.slice(0, 7).arrayBuffer());
    checkAbort();
    const plainMagic = [72, 79, 73, 52, 116, 120, 116]; // HOI4txt
    if (prefix.length !== 7 || !prefix.every((byte, index) => byte === plainMagic[index]))
      return body; // ZIP/binary/unknown saves keep their existing validation path.
    const gzip = new CompressionStream("gzip");
    onPreparing?.();
    const maximum = Math.min(
      GZIP_MAX_BLOB_BYTES, Math.floor(file.size * GZIP_MAX_RETAINED_RATIO),
      file.size - GZIP_MIN_SAVED_BYTES,
    );
    let bytes = 0;
    const stream = file.stream().pipeThrough(gzip, { signal }).pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > maximum)
            throw new Error("Transport compression is not worthwhile");
          controller.enqueue(chunk);
        },
      }),
      { signal },
    );
    const compressed = await new Response(stream).blob();
    checkAbort();
    if (!compressed.size || compressed.size > maximum) return body;
    const prepared = new FormData();
    // The server must know the codec before it starts streaming the file part.
    prepared.append("transportEncoding", "gzip");
    for (const [key, value] of body.entries()) {
      if (key === "transportEncoding") continue;
      if (key === "file") prepared.append(key, compressed, file.name);
      else prepared.append(key, value);
    }
    return prepared;
  } catch {
    checkAbort(); // Cancellation must never become a fallback upload.
    return body; // No request has started; unsupported/failed compression is safe to bypass.
  }
}
