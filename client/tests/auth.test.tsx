import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthGate } from "../src/components/auth/AuthGate";
import { apiFetch } from "../src/lib/api-client";
import { seedCsrfCookie } from "./auth-fixture";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "user@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("frontend authentication boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.cookie = "hoi4_csrf=; Max-Age=0; Path=/";
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async () => {
    await act(async () =>
      root.render(
        <AuthGate>
          <div>Private application</div>
        </AuthGate>,
      ),
    );
  };

  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === label,
    )!;

  const fillCredentials = () => {
    const email = container.querySelector<HTMLInputElement>(
      'input[name="email"]',
    )!;
    const password = container.querySelector<HTMLInputElement>(
      'input[name="password"]',
    )!;
    email.value = user.email;
    password.value = "correct horse battery staple";
  };

  const submit = async () => {
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  };

  test("shows a loading state without prematurely mounting private UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    await render();
    expect(container.textContent).toContain("Checking your session");
    expect(container.textContent).not.toContain("Private application");
  });

  test("authenticated bootstrap shows the user and private application", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ user })));
    await render();
    expect(container.textContent).toContain("Private application");
    expect(container.textContent).toContain(`Signed in as ${user.email}`);
  });

  test("unauthenticated bootstrap shows sign-in without private UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    await render();
    expect(container.textContent).toContain("Sign in");
    expect(container.textContent).not.toContain("Private application");
  });

  test("login establishes authenticated UI without exposing a session token", async () => {
    seedCsrfCookie();
    const fetchMock = vi.fn((path: string) =>
      Promise.resolve(
        path === "/api/auth/me"
          ? new Response(null, { status: 401 })
          : Response.json({ user }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await render();
    fillCredentials();
    await submit();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/login");
    expect(container.textContent).toContain("Private application");
    expect(localStorage.getItem("hoi4_session")).toBeNull();
    expect(sessionStorage.getItem("hoi4_session")).toBeNull();
  });

  test("registration uses the same protected auth flow", async () => {
    seedCsrfCookie();
    const fetchMock = vi.fn((path: string) =>
      Promise.resolve(
        path === "/api/auth/me"
          ? new Response(null, { status: 401 })
          : Response.json({ user }, { status: 201 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await act(async () => button("New here? Create an account").click());
    fillCredentials();
    await submit();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/register");
    expect(container.textContent).toContain("Private application");
  });

  test("logout clears authenticated UI through the public idempotent endpoint", async () => {
    seedCsrfCookie();
    const fetchMock = vi.fn((path: string) =>
      Promise.resolve(
        path === "/api/auth/logout"
          ? new Response(null, { status: 204 })
          : Response.json({ user }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await act(async () => button("Sign out").click());
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/logout");
    expect(container.textContent).toContain("Sign in");
    expect(container.textContent).not.toContain("Private application");
  });

  test("a centralized private 401 transitions to the expired-session UI", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ user }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await act(async () => {
      await apiFetch("/api/analyze/recent");
    });
    expect(container.textContent).toContain("Your session ended");
    const privateShell =
      container.querySelector<HTMLDivElement>("div[hidden]")!;
    expect(privateShell.hidden).toBe(true);
    expect(privateShell.hasAttribute("inert")).toBe(true);
  });

  test("a CSRF 403 shows recovery guidance without signing the user out", async () => {
    seedCsrfCookie();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ user }))
      .mockResolvedValueOnce(
        Response.json({ code: "CSRF_INVALID" }, { status: 403 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await act(async () => {
      await apiFetch("/api/analyze/recent/abc", { method: "DELETE" });
    });
    expect(container.textContent).toContain("Private application");
    expect(container.textContent).toContain("security token");
    expect(container.textContent).not.toContain("Your session ended");
  });
});
