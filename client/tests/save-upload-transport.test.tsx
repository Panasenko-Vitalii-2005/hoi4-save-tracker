// @vitest-environment node
import { randomFillSync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prepareSaveUpload, GZIP_MIN_SOURCE_BYTES, GZIP_MAX_BLOB_BYTES } from "../src/lib/save-upload-transport";
import { apiAnalyzeUpload } from "../src/lib/api-client";
import { installUploadXhr, UploadXhr } from "./xhr-fixture";

const nativeGzip = CompressionStream;
const bytes = () => {
  const data = new Uint8Array(GZIP_MIN_SOURCE_BYTES).fill(65);
  data.set(new TextEncoder().encode("HOI4txt"));
  return data;
};
const form = (data = bytes()) => {
  const file = new File([data], "autosave.hoi4");
  const body = new FormData();
  body.append("file", file);
  return {body, file};
};
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 1000; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Transport test did not settle");
};

describe("bounded native save transport preparation", () => {
  beforeEach(() => {
    vi.stubGlobal("CompressionStream", nativeGzip);
    vi.stubGlobal("document", { cookie: `hoi4_csrf=${"c".repeat(43)}` });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("ProgressEvent", class extends Event {
      loaded: number; total: number; lengthComputable: boolean;
      constructor(type: string, init: ProgressEventInit) {
        super(type); this.loaded = init.loaded ?? 0; this.total = init.total ?? 0;
        this.lengthComputable = init.lengthComputable ?? false;
      }
    });
    installUploadXhr();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  test("native gzip preserves every original byte and puts marker before file without a source arrayBuffer", async () => {
    const data = bytes();
    const {body, file} = form(data);
    const wholeBuffer = vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("Whole file buffering forbidden"));
    const preparing = vi.fn();
    const prepared = await prepareSaveUpload(body, undefined, preparing);
    expect(preparing).toHaveBeenCalledOnce();
    expect([...prepared.keys()]).toEqual(["transportEncoding", "file"]);
    expect(prepared.get("transportEncoding")).toBe("gzip");
    const compressed = prepared.get("file") as File;
    expect(compressed.name).toBe(file.name);
    expect(compressed.size).toBeLessThan(data.length * 0.1);
    expect(gunzipSync(Buffer.from(await compressed.arrayBuffer())).equals(Buffer.from(data))).toBe(true);
    expect(wholeBuffer).not.toHaveBeenCalled();
    expect(body.has("transportEncoding")).toBe(false);
  });

  test.each(["tiny", "zip", "binary", "unknown"])("%s bypasses compression", async (kind) => {
    const data = kind === "tiny" ? new TextEncoder().encode("HOI4txt") : bytes();
    if (kind !== "tiny") data.set(new TextEncoder().encode(kind === "zip" ? "PK\u0003\u0004xxx" : kind === "binary" ? "HOI4bin" : "EU4txtx"));
    const {body} = form(data);
    const preparing = vi.fn();
    expect(await prepareSaveUpload(body, undefined, preparing)).toBe(body);
    expect(preparing).not.toHaveBeenCalled();
  });

  test.each(["missing", "unsupported", "stream-error"])("%s compression falls back before any request", async (kind) => {
    const {body, file} = form();
    if (kind === "missing") vi.stubGlobal("CompressionStream", undefined);
    if (kind === "unsupported") vi.stubGlobal("CompressionStream", class { constructor() { throw new TypeError("unsupported gzip"); } });
    if (kind === "stream-error") vi.spyOn(file, "stream").mockReturnValue(new ReadableStream({start(c) {c.error(new Error("read failed"));}}));
    expect(await prepareSaveUpload(body)).toBe(body);
    expect(UploadXhr.requests).toHaveLength(0);
  });

  test("insufficient savings discard compressed output and keep the exact original File", async () => {
    const data = randomFillSync(bytes());
    data.set(new TextEncoder().encode("HOI4txt"));
    const {body, file} = form(data);
    expect(await prepareSaveUpload(body)).toBe(body);
    expect(body.get("file")).toBe(file);
  });

  test("prepared Blob byte ceiling cancels the stream instead of accumulating an oversized result", async () => {
    const {body, file} = form();
    Object.defineProperty(file, "size", {value:64 * 1024 * 1024});
    const cancelled = vi.fn();
    let sent = 0;
    vi.spyOn(file, "stream").mockReturnValue(new ReadableStream({
      pull(c) { if (sent++ < 64) c.enqueue(new Uint8Array(1024 * 1024)); else c.close(); }, cancel:cancelled,
    }));
    vi.stubGlobal("CompressionStream", class extends TransformStream { constructor() {super({transform(chunk,c) {c.enqueue(chunk);}});} });
    expect(await prepareSaveUpload(body)).toBe(body);
    expect(sent * 1024 * 1024).toBeLessThan(64 * 1024 * 1024);
    expect(GZIP_MAX_BLOB_BYTES).toBe(32 * 1024 * 1024);
    await waitFor(() => cancelled.mock.calls.length > 0);
  });

  test("API preparation precedes upload and keeps measured progress, CSRF and credentials", async () => {
    const {body} = form();
    const stages: string[] = [];
    const progress = vi.fn();
    const result = apiAnalyzeUpload(body, { onPreparing:()=>stages.push("preparing"), onUploading:()=>stages.push("uploading"), onUploaded:()=>stages.push("analyzing"), onProgress:progress });
    await waitFor(() => UploadXhr.requests.length === 1);
    const xhr = UploadXhr.requests[0];
    expect(stages).toEqual(["preparing", "uploading"]);
    expect(xhr.body?.get("transportEncoding")).toBe("gzip");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers.get("X-CSRF-Token")).toBe("c".repeat(43));
    expect(xhr.headers.has("Content-Type")).toBe(false);
    expect(progress).not.toHaveBeenCalled();
    xhr.progress(50,100);
    expect(progress).toHaveBeenCalledExactlyOnceWith({loaded:50,total:100});
    xhr.uploaded();
    expect(stages).toEqual(["preparing", "uploading", "analyzing"]);
    await xhr.respond(Response.json({ unchanged:true }, {status:201}));
    expect(await (await result).json()).toEqual({ unchanged:true });
  });

  test("cancelling preparation cancels its stream and prevents plaintext fallback/request", async () => {
    const {body, file} = form();
    const controller = new AbortController();
    const cancelled = vi.fn();
    vi.spyOn(file,"stream").mockReturnValue(new ReadableStream({start(c) {c.enqueue(new Uint8Array(100));}, cancel:cancelled}));
    const preparing = vi.fn();
    const result = apiAnalyzeUpload(body, { signal:controller.signal, onPreparing:preparing });
    await waitFor(() => preparing.mock.calls.length > 0);
    controller.abort();
    await expect(result).rejects.toMatchObject({name:"AbortError"});
    expect(UploadXhr.requests).toHaveLength(0);
    await waitFor(() => cancelled.mock.calls.length > 0);
  });

  test.each(["abort", "network", "auth"])("%s after compressed send never retries plaintext", async (kind) => {
    const controller = new AbortController();
    const result = apiAnalyzeUpload(form().body, {signal:controller.signal});
    await waitFor(() => UploadXhr.requests.length === 1);
    const xhr = UploadXhr.requests[0];
    if (kind === "abort") { controller.abort(); await expect(result).rejects.toMatchObject({name:"AbortError"}); }
    else if (kind === "network") { xhr.fail(); await expect(result).rejects.toThrow("Network request failed"); }
    else { await xhr.respond(Response.json({code:"UNAUTHORIZED"},{status:401})); expect((await result).status).toBe(401); }
    expect(UploadXhr.requests).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(["unsupported", "failed", "zip"])("%s API fallback sends the original multipart once", async (kind) => {
    const data = bytes();
    if (kind === "zip") data.set(new TextEncoder().encode("PK\u0003\u0004xxx"));
    const {body, file} = form(data);
    if (kind === "unsupported") vi.stubGlobal("CompressionStream",undefined);
    if (kind === "failed") vi.stubGlobal("CompressionStream",class { constructor() { throw new Error("gzip unavailable"); } });
    const result = apiAnalyzeUpload(body);
    await waitFor(() => UploadXhr.requests.length === 1);
    expect(UploadXhr.requests[0].body).toBe(body);
    expect(UploadXhr.requests[0].body?.get("file")).toBe(file);
    expect(body.has("transportEncoding")).toBe(false);
    await UploadXhr.requests[0].respond(Response.json({unchanged:true}));
    await result;
    expect(UploadXhr.requests).toHaveLength(1);
  });
});
