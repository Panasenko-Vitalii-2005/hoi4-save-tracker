import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, test, expect, vi } from "vitest";
import { AuthGate } from "../src/components/auth/AuthGate";
import { SharedAnalysisPage } from "../src/components/analyzer/SharedAnalysisPage";
import { i18n } from "../src/i18n";
import {
  apiFetch,
  CSRF_REJECTED_EVENT,
  SESSION_EXPIRED_EVENT,
} from "../src/lib/api-client";
import { analysisError } from "../src/lib/analysis-error";
import { rateLimitMessage } from "../src/lib/rate-limit";
import { seedCsrfCookie } from "./auth-fixture";

vi.mock("../src/components/analyzer/AnalyzerTab", () => ({
  AnalyzerTab: () => <div>Shared result</div>,
}));

describe("alpha admission and retry guidance", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    seedCsrfCookie();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    await i18n.changeLanguage("en");
  });
  const renderAuth = async () => {
    await act(async () =>
      root.render(
        <AuthGate>
          <div>Private result</div>
        </AuthGate>,
      ),
    );
  };
  const submit = async () => {
    container.querySelector<HTMLInputElement>('input[name="email"]')!.value =
      "invited@example.invalid";
    container.querySelector<HTMLInputElement>('input[name="password"]')!.value =
      "valid secret password";
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
  };
  test.each(["en", "ru"])(
    "%s signup denial is invitation guidance, not CSRF failure or a secret",
    async (locale) => {
      await i18n.changeLanguage(locale);
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          Promise.resolve(
            url === "/api/auth/me"
              ? new Response(null, { status: 401 })
              : Response.json(
                  {
                    code: "REGISTRATION_NOT_INVITED",
                    message: "secret-allowlist",
                  },
                  { status: 403 },
                ),
          ),
        ),
      );
      await renderAuth();
      await act(async () => {
        [...container.querySelectorAll("button")]
          .find((button) => button.textContent === i18n.t("auth.newHere"))!
          .click();
      });
      await submit();
      expect(container.querySelector('[role="alert"]')!.textContent).toBe(
        i18n.t("auth.invitationRequired"),
      );
      expect(container.textContent).not.toContain("secret-allowlist");
      expect(container.textContent).not.toContain("Private result");
    },
  );
  test.each(["en", "ru"])(
    "%s login throttle has bounded retry guidance and no automatic replay",
    async (locale) => {
      await i18n.changeLanguage(locale);
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          url === "/api/auth/me"
            ? new Response(null, { status: 401 })
            : Response.json(
                { code: "RATE_LIMITED", message: "private server stack" },
                { status: 429, headers: { "Retry-After": "900" } },
              ),
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      await renderAuth();
      await submit();
      expect(container.querySelector('[role="alert"]')!.textContent).toBe(
        i18n.t("common.rateLimitedWait", { seconds: 900 }),
      );
      expect(container.textContent).not.toContain("private server stack");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  test.each(["en", "ru"])(
    "%s public share 429 remains recoverable and does not render a result",
    async (locale) => {
      await i18n.changeLanguage(locale);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "60" },
          }),
        ),
      );
      await act(async () =>
        root.render(<SharedAnalysisPage publicId={"s".repeat(22)} />),
      );
      expect(container.textContent).toContain(
        i18n.t("common.rateLimitedWait", { seconds: 60 }),
      );
      expect(container.textContent).toContain(i18n.t("common.retry"));
      expect(container.textContent).not.toContain("Shared result");
    },
  );
  test.each(["en", "ru"])(
    "%s upload rejection uses retry rather than false saved success",
    async (locale) => {
      await i18n.changeLanguage(locale);
      const failure = await analysisError(
        new Response(null, { status: 429, headers: { "Retry-After": "3600" } }),
      );
      expect(failure).toEqual({
        type: "busy",
        recovery: "retry",
        msg: i18n.t("common.rateLimitedWait", { seconds: 3600 }),
      });
    },
  );
  test("only bounded numeric Retry-After is rendered; no arbitrary server text", () => {
    for (const value of ["-1", "NaN", "9999999", "2026-10-08", "secret"]) {
      expect(
        rateLimitMessage(
          new Response(null, { headers: { "Retry-After": value } }),
        ),
      ).toBe(i18n.t("common.rateLimited"));
    }
  });
  test("admission denial and throttling do not announce session expiry or CSRF, or replay requests", async () => {
    const expired = vi.fn(),
      csrf = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    window.addEventListener(CSRF_REJECTED_EVENT, csrf);
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ code: "REGISTRATION_NOT_INVITED" }, { status: 403 }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 429 }));
      vi.stubGlobal("fetch", fetchMock);
      await apiFetch("/api/auth/register", { method: "POST" }, "public");
      await apiFetch("/api/analyze", { method: "POST" });
      expect(expired).not.toHaveBeenCalled();
      expect(csrf).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
      window.removeEventListener(CSRF_REJECTED_EVENT, csrf);
    }
  });
});
