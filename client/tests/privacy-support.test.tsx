import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "../src/App";
import { PrivacyNotice } from "../src/components/privacy/PrivacyNotice";
import { i18n } from "../src/i18n";

vi.mock("react-plotly.js", () => ({ default: () => null }));
vi.mock("../src/components/analyzer/SharedAnalysisPage", () => ({
  SharedAnalysisPage: () => <main>Public snapshot</main>,
}));

describe("public privacy and operator support", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    window.history.replaceState({}, "", "/");
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    await i18n.changeLanguage("en");
    window.history.replaceState({}, "", "/");
  });
  async function expand() {
    await act(async () => {
      const details = container.querySelector("details")!;
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
  }
  test.each(["en", "ru"])(
    "%s privacy and real configured mailbox need no authentication",
    async (locale) => {
      await i18n.changeLanguage(locale);
      const fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json({ supportEmail: "alpha-support@example.invalid" }),
        );
      vi.stubGlobal("fetch", fetch);
      await act(async () => root.render(<PrivacyNotice />));
      expect(fetch).not.toHaveBeenCalled();
      await expand();
      expect(fetch).toHaveBeenCalledWith(
        "/api/privacy",
        expect.objectContaining({ credentials: "include", cache: "no-store" }),
      );
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "mailto:alpha-support@example.invalid",
      );
      for (const key of [
        "uploads",
        "sharing",
        "accountData",
        "deletion",
        "backups",
        "supportScope",
        "verification",
      ])
        expect(container.textContent).toContain(i18n.t(`privacy.${key}`));
      expect(container.textContent).toContain("90");
      expect(container.textContent).not.toMatch(
        /immediate complete erasure is guaranteed|автоматическ.*сброс пароля доступен/i,
      );
      expect(container.textContent).toContain(
        locale === "ru"
          ? "не автоматическим планировщиком"
          : "not an automatic scheduler",
      );
      expect(container.textContent).toContain(
        locale === "ru"
          ? "сама по себе не подтверждает"
          : "alone is not ownership proof",
      );
    },
  );
  test.each(["en", "ru"])(
    "%s missing contact visibly fails safe without invented mailto",
    async (locale) => {
      await i18n.changeLanguage(locale);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ supportEmail: null })),
      );
      await act(async () => root.render(<PrivacyNotice />));
      await expand();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        i18n.t("privacy.supportUnavailable"),
      );
      expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    },
  );
  test.each(["network", "unsafe"])(
    "%s contact fails closed and offers retry",
    async (kind) => {
      const fetch = vi.fn().mockImplementation(() =>
        kind === "network"
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(
              Response.json({
                supportEmail: "mail@example.invalid?bcc=other",
              }),
            ),
      );
      vi.stubGlobal("fetch", fetch);
      await act(async () => root.render(<PrivacyNotice />));
      await expand();
      expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Support currently unavailable",
      );
      fetch.mockResolvedValue(
        Response.json({ supportEmail: "support@example.invalid" }),
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>("button")!.click(),
      );
      expect(container.querySelector("a")?.textContent).toBe(
        "support@example.invalid",
      );
    },
  );
  test.each(["/", "/share/AbCdEfGhIjKlMnOpQrStUv"])(
    "guidance is reachable on %s before private access",
    async (path) => {
      window.history.replaceState({}, "", path);
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          Promise.resolve(
            url === "/api/auth/me"
              ? new Response(null, { status: 401 })
              : Response.json({ supportEmail: null }),
          ),
        ),
      );
      await act(async () => root.render(<App />));
      expect(container.querySelector("footer summary")?.textContent).toBe(
        "Privacy & alpha support",
      );
      await expand();
      expect(container.textContent).toContain("Support currently unavailable");
    },
  );
  test.each(["en", "ru"])(
    "%s removal and sharing confirmations disclose global co-owner policy",
    async (locale) => {
      await i18n.changeLanguage(locale);
      const marker = locale === "ru" ? "совладельц" : "co-owner";
      for (const key of [
        "history.deleteConfirm",
        "storage.confirmBody",
        "share.revokeConfirm",
      ])
        expect(i18n.t(key)).toContain(marker);
      expect(i18n.t("share.privacy")).toContain(
        locale === "ru" ? "идентифицировать" : "identify you",
      );
    },
  );
});
