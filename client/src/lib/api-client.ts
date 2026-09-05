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
  return response;
}
