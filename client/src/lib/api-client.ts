import { canPrepareSaveUpload, prepareSaveUpload } from "./save-upload-transport";

export const SESSION_EXPIRED_EVENT = "hoi4:session-expired";
export const CSRF_REJECTED_EVENT = "hoi4:csrf-rejected";

const CSRF_TOKEN = /^[A-Za-z0-9_-]{43}$/;
let csrfBootstrap: Promise<string> | null = null;

function csrfCookie(): string | null {
  const cookies = document.cookie.split(";").map((cookie) => cookie.trim());
  const matches = cookies.filter((cookie) => cookie.startsWith("hoi4_csrf="));
  if (matches.length !== 1) return null;
  const token = matches[0].slice("hoi4_csrf=".length);
  return CSRF_TOKEN.test(token) ? token : null;
}

async function ensureCsrf(): Promise<string> {
  const token = csrfCookie();
  if (token) return token;
  // Coalesce concurrent pre-authentication requests without caching a cookie
  // value indefinitely: another browser tab can replace the readable cookie.
  if (!csrfBootstrap) {
    csrfBootstrap = (async () => {
      const response = await fetch("/api/auth/csrf", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Security token is unavailable");
      const value: unknown = await response.json();
      const received =
        value && typeof value === "object" && "csrfToken" in value
          ? value.csrfToken
          : null;
      if (typeof received !== "string" || !CSRF_TOKEN.test(received))
        throw new Error("Security token is unavailable");
      return csrfCookie() ?? received;
    })().finally(() => {
      csrfBootstrap = null;
    });
  }
  return csrfBootstrap;
}

/** All application HTTP requests use the browser's HttpOnly session cookie. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  access: "private" | "public" = "private",
): Promise<Response> {
  if (!path.startsWith("/api/")) throw new Error("Invalid API path");
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-CSRF-Token", await ensureCsrf());
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  await announceAuthFailure(response, access);
  return response;
}

async function announceAuthFailure(
  response: Response,
  access: "private" | "public" = "private",
): Promise<void> {
  if (access === "private" && response.status === 401)
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  if (response.status === 403) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "code" in body &&
      body.code === "CSRF_INVALID"
    )
      window.dispatchEvent(new Event(CSRF_REJECTED_EVENT));
  }
  // Never replay an unsafe operation automatically after either failure.
}

export interface SaveUploadProgress {
  loaded: number;
  total: number | null;
}

/** Only multipart analyze requests use XHR; other API calls keep using fetch. */
export async function apiAnalyzeUpload(
  body: FormData,
  {
    batch = false,
    signal,
    onPreparing,
    onUploading,
    onProgress,
    onUploaded,
  }: {
    batch?: boolean;
    signal?: AbortSignal;
    onPreparing?: () => void;
    onUploading?: () => void;
    onProgress?: (progress: SaveUploadProgress) => void;
    onUploaded?: () => void;
  } = {},
): Promise<Response> {
  const aborted = () => new DOMException("Request aborted", "AbortError");
  if (signal?.aborted) throw aborted();
  const token = await ensureCsrf();
  if (signal?.aborted) throw aborted();
  if (canPrepareSaveUpload(body))
    body = await prepareSaveUpload(body, signal, onPreparing);
  if (signal?.aborted) throw aborted();
  onUploading?.();
  const response = await new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let uploaded = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      xhr.upload.removeEventListener("progress", progress);
      xhr.upload.removeEventListener("load", uploadComplete);
      xhr.removeEventListener("load", load);
      xhr.removeEventListener("error", fail);
      xhr.removeEventListener("timeout", fail);
      xhr.removeEventListener("abort", cancelled);
    };
    const finish = (work: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      work();
    };
    const uploadComplete = () => {
      if (settled || uploaded) return;
      uploaded = true;
      onUploaded?.();
    };
    const progress = (event: ProgressEvent) => {
      if (settled || uploaded || !Number.isFinite(event.loaded) || event.loaded < 0)
        return;
      const total =
        event.lengthComputable && Number.isFinite(event.total) && event.total > 0
          ? event.total
          : null;
      // Do not leave a 100% upload bar visible while waiting for the server.
      if (total !== null && event.loaded >= total) uploadComplete();
      else onProgress?.({ loaded: event.loaded, total });
    };
    const load = () => {
      try {
        const headers = new Headers();
        for (const line of xhr.getAllResponseHeaders().split(/\r?\n/)) {
          const separator = line.indexOf(":");
          if (separator > 0)
            headers.append(
              line.slice(0, separator).trim(),
              line.slice(separator + 1).trim(),
            );
        }
        const response = new Response(
          [204, 205, 304].includes(xhr.status) ? null : xhr.responseText,
          { status: xhr.status, statusText: xhr.statusText, headers },
        );
        finish(() => resolve(response));
      } catch {
        finish(() => reject(new TypeError("Analysis response unavailable")));
      }
    };
    const fail = () =>
      finish(() => reject(new TypeError("Network request failed")));
    const cancelled = () => finish(() => reject(aborted()));
    const abort = () => {
      xhr.abort();
      cancelled();
    };
    try {
      // Register upload listeners before open/send for browser compatibility.
      xhr.upload.addEventListener("progress", progress);
      xhr.upload.addEventListener("load", uploadComplete);
      xhr.addEventListener("load", load);
      xhr.addEventListener("error", fail);
      xhr.addEventListener("timeout", fail);
      xhr.addEventListener("abort", cancelled);
      xhr.open("POST", batch ? "/api/analyze?response=batch" : "/api/analyze");
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-CSRF-Token", token);
      // Browser supplies the multipart Content-Type/boundary; never set it here.
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else xhr.send(body);
    } catch (error) {
      finish(() => reject(error));
    }
  });
  await announceAuthFailure(response);
  return response;
}
