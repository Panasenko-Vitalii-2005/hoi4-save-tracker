import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  apiFetch,
  CSRF_REJECTED_EVENT,
  SESSION_EXPIRED_EVENT,
} from "../src/lib/api-client";
import { seedCsrfCookie } from "./auth-fixture";

describe("central API client", () => {
  beforeEach(() => {
    document.cookie = "hoi4_csrf=; Max-Age=0; Path=/";
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  test("includes credentials centrally on safe requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/analyze/recent");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analyze/recent",
      expect.objectContaining({ credentials: "include" }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).has("X-CSRF-Token")).toBe(false);
  });

  test("adds the readable CSRF cookie to unsafe requests", async () => {
    seedCsrfCookie();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/analyze/recent/abc", { method: "DELETE" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("c".repeat(43));
    expect(init.credentials).toBe("include");
  });

  test("bootstraps a missing CSRF token once before the unsafe request", async () => {
    const token = "b".repeat(43);
    const fetchMock = vi.fn((path: string, init?: RequestInit) => {
      if (path === "/api/auth/csrf")
        return Promise.resolve(Response.json({ csrfToken: token }));
      expect(path).toBe("/api/auth/login");
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(token);
      return Promise.resolve(Response.json({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiFetch("/api/auth/login", { method: "POST" }, "public");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
    });
  });

  test("a private 401 announces expiry while a public 401 does not", async () => {
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    try {
      await apiFetch("/api/analyze/recent");
      expect(expired).toHaveBeenCalledTimes(1);
      await apiFetch("/api/auth/me", {}, "public");
      expect(expired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
    }
  });

  test("a CSRF 403 is distinct from session expiry and is never retried", async () => {
    seedCsrfCookie();
    const expired = vi.fn();
    const rejected = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    window.addEventListener(CSRF_REJECTED_EVENT, rejected);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ code: "CSRF_INVALID" }, { status: 403 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await apiFetch("/api/analyze/recent/abc", { method: "PATCH" });
      expect(rejected).toHaveBeenCalledTimes(1);
      expect(expired).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
      window.removeEventListener(CSRF_REJECTED_EVENT, rejected);
    }
  });

  test("never stores a session or CSRF token in browser storage", async () => {
    seedCsrfCookie();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ok: true })),
    );

    await apiFetch("/api/auth/login", { method: "POST" }, "public");

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
