import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apiAnalyzeUpload, CSRF_REJECTED_EVENT, SESSION_EXPIRED_EVENT } from "../src/lib/api-client";
import { seedCsrfCookie } from "./auth-fixture";
import { installUploadXhr, UploadXhr } from "./xhr-fixture";

describe("real-progress analyze upload transport", () => {
  beforeEach(() => {
    seedCsrfCookie();
    installUploadXhr();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());
  const form = () => {
    const body = new FormData();
    body.append("file", new File(["HOI4txt"], "save.hoi4"));
    return body;
  };
  const sent = async () => {
    await Promise.resolve();
    expect(UploadXhr.requests).toHaveLength(1);
    return UploadXhr.requests[0];
  };

  test("uses the same field/endpoint, credentials and CSRF without fetch or explicit Content-Type", async () => {
    const body = form();
    const response = apiAnalyzeUpload(body);
    const xhr = await sent();
    expect(xhr.url).toBe("/api/analyze");
    expect(xhr.method).toBe("POST");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers.get("X-CSRF-Token")).toBe("c".repeat(43));
    expect(xhr.headers.has("Content-Type")).toBe(false);
    expect(xhr.body).toBe(body);
    expect((xhr.body!.get("file") as File).name).toBe("save.hoi4");
    expect(fetch).not.toHaveBeenCalled();
    await xhr.respond(Response.json({ unchanged: true }, { status: 201, headers: { "X-Analysis-Hash": "a".repeat(64), "X-Analysis-Persistence": "saved" } }));
    const result = await response;
    expect(result.status).toBe(201);
    expect(result.headers.get("X-Analysis-Hash")).toBe("a".repeat(64));
    expect(result.headers.get("X-Analysis-Persistence")).toBe("saved");
    expect(await result.json()).toEqual({ unchanged: true });
  });

  test("forwards measured bytes only and announces upload completion once, ignoring late progress", async () => {
    const onProgress = vi.fn();
    const onUploaded = vi.fn();
    const response = apiAnalyzeUpload(form(), { onProgress, onUploaded, batch: true });
    const xhr = await sent();
    expect(xhr.url).toBe("/api/analyze?response=batch");
    expect(onProgress).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    xhr.progress(50, 100);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith({ loaded: 50, total: 100 });
    xhr.progress(100, 100);
    xhr.uploaded();
    xhr.progress(50, 100);
    expect(onUploaded).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledOnce();
    await xhr.respond(Response.json({}));
    await response;
  });

  test("unknown-length events preserve actual bytes but never invent a total", async () => {
    const onProgress = vi.fn();
    const onUploaded = vi.fn();
    const response = apiAnalyzeUpload(form(), { onProgress, onUploaded });
    const xhr = await sent();
    xhr.progress(50, 0, false);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith({ loaded: 50, total: null });
    expect(onUploaded).not.toHaveBeenCalled();
    xhr.uploaded();
    expect(onUploaded).toHaveBeenCalledOnce();
    await xhr.respond(Response.json({}));
    await response;
  });

  test("network failure rejects without raw server information or retry", async () => {
    const response = apiAnalyzeUpload(form());
    const xhr = await sent();
    xhr.fail();
    await expect(response).rejects.toThrow("Network request failed");
    expect(UploadXhr.requests).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each(["signal", "xhr"])("%s cancellation rejects with AbortError and detaches handlers", async (source) => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    const onUploaded = vi.fn();
    const response = apiAnalyzeUpload(form(), { signal: controller.signal, onProgress, onUploaded });
    const xhr = await sent();
    if (source === "signal") controller.abort();
    else xhr.abort();
    await expect(response).rejects.toMatchObject({ name: "AbortError" });
    xhr.progress(50, 100);
    xhr.uploaded();
    await xhr.respond(Response.json({}));
    expect(onProgress).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
    expect(UploadXhr.requests).toHaveLength(1);
  });

  test("already-aborted requests do not bootstrap CSRF or send a file", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(apiAnalyzeUpload(form(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    expect(UploadXhr.requests).toHaveLength(0);
  });

  test("missing CSRF is bootstrapped with existing fetch policy before upload", async () => {
    document.cookie = "hoi4_csrf=; Max-Age=0; Path=/";
    vi.mocked(fetch).mockResolvedValue(Response.json({ csrfToken: "b".repeat(43) }));
    const response = apiAnalyzeUpload(form());
    for (let attempt = 0; attempt < 20 && !UploadXhr.requests.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/auth/csrf", { credentials: "include", cache: "no-store" });
    const xhr = UploadXhr.requests[0];
    expect(xhr.headers.get("X-CSRF-Token")).toBe("b".repeat(43));
    await xhr.respond(Response.json({}));
    await response;
  });

  test("cancellation during CSRF bootstrap prevents a later upload", async () => {
    document.cookie = "hoi4_csrf=; Max-Age=0; Path=/";
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((yes) => { resolve = yes; }));
    const controller = new AbortController();
    const response = apiAnalyzeUpload(form(), { signal: controller.signal });
    controller.abort();
    resolve(Response.json({ csrfToken: "b".repeat(43) }));
    await expect(response).rejects.toMatchObject({ name: "AbortError" });
    expect(UploadXhr.requests).toHaveLength(0);
  });

  test.each([401, 403])("HTTP %i preserves auth events and readable error body, without retry", async (status) => {
    const expired = vi.fn();
    const csrf = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    window.addEventListener(CSRF_REJECTED_EVENT, csrf);
    try {
      const response = apiAnalyzeUpload(form());
      const xhr = await sent();
      await xhr.respond(Response.json({ code: status === 403 ? "CSRF_INVALID" : "UNAUTHORIZED" }, { status }));
      const result = await response;
      expect(result.status).toBe(status);
      expect(await result.json()).toMatchObject({ code: status === 403 ? "CSRF_INVALID" : "UNAUTHORIZED" });
      expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(csrf).toHaveBeenCalledTimes(status === 403 ? 1 : 0);
      expect(UploadXhr.requests).toHaveLength(1);
    } finally {
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
      window.removeEventListener(CSRF_REJECTED_EVENT, csrf);
    }
  });
});
