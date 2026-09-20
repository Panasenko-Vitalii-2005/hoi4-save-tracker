import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LanguageSwitcher } from "../src/components/ui/LanguageSwitcher";
import { TabBar } from "../src/components/ui/TabBar";
import { AuthGate } from "../src/components/auth/AuthGate";
import { ShareAnalysisDialog } from "../src/components/analyzer/ShareAnalysisDialog";
import { analysisError } from "../src/lib/analysis-error";
import { trackAnalysisEvent } from "../src/lib/product-telemetry";
import {
  i18n,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  useAppTranslation,
} from "../src/i18n";
import { seedCsrfCookie } from "./auth-fixture";

function ProductLabels() {
  const { t } = useAppTranslation();
  return (
    <div>
      <span>{t("analysis.uploadAria")}</span>
      <span>{t("analysis.sections.overview")}</span>
      <span>{t("analysis.sections.warCasualties")}</span>
      <span>{t("analysis.sections.navalLosses")}</span>
      <span>{t("analysis.sections.stockpile")}</span>
      <span>{t("analysis.sections.production")}</span>
      <span>{t("analysis.sections.landForces")}</span>
    </div>
  );
}

describe("frontend localization foundation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    await i18n.changeLanguage("en");
    vi.unstubAllGlobals();
  });

  test("English and Russian are available and English is the fallback", async () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["en", "ru"]);
    i18n.addResource("en", "translation", "test.englishOnly", "English fallback");
    await i18n.changeLanguage("ru");
    expect(i18n.t("test.englishOnly")).toBe("English fallback");
    i18n.removeResourceBundle("en", "test");
  });

  test("the keyboard-accessible selector switches immediately, persists, and updates html lang", async () => {
    await act(async () =>
      root.render(
        <>
          <LanguageSwitcher />
          <TabBar active="chart" onChange={() => undefined} />
          <ProductLabels />
        </>,
      ),
    );
    expect(container.textContent).toContain("Campaign Trends");

    const selector = container.querySelector("select[aria-label='Language']") as HTMLSelectElement;
    selector.value = "ru";
    await act(async () => selector.dispatchEvent(new Event("change", { bubbles: true })));

    expect(container.textContent).toContain("Динамика кампании");
    expect(container.textContent).toContain("Потери в войне");
    expect(container.textContent).toContain("Потери флота");
    expect(container.textContent).toContain("Запасы");
    expect(container.textContent).toContain("Производство");
    expect(container.textContent).toContain("Сухопутные войска");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
  });

  test("auth and sharing surfaces render Russian UI", async () => {
    await i18n.changeLanguage("ru");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    await act(async () =>
      root.render(
        <AuthGate>
          <div>private</div>
        </AuthGate>,
      ),
    );
    expect(container.textContent).toContain("Войти");
    expect(container.textContent).toContain("Создать аккаунт");

    await act(async () => root.unmount());
    root = createRoot(container);
    const item = {
      hash: "a".repeat(64), fileName: "save.hoi4", gameDate: "1944.5.1",
      analyzedAt: "2026-01-01T00:00:00.000Z", fileSizeBytes: 1,
      hasPersistedResult: true, pinned: false,
    };
    await act(async () =>
      root.render(
        <ShareAnalysisDialog
          item={item}
          onClose={() => undefined}
          onCreated={() => undefined}
          onRevoked={() => undefined}
        />,
      ),
    );
    expect(container.textContent).toContain("Поделиться анализом");
    expect(container.textContent).toContain("Создать публичную ссылку");
  });

  test("stable backend error codes remain untouched while presentation is localized", async () => {
    await i18n.changeLanguage("ru");
    const response = Response.json(
      { code: "UNSUPPORTED_BINARY_SAVE" },
      { status: 422 },
    );
    const failure = await analysisError(response.clone());
    expect((await response.json()).code).toBe("UNSUPPORTED_BINARY_SAVE");
    expect(failure.msg).toContain("бинарное сохранение");
    expect(failure.reason).toBe("unsupported-binary-save");
  });

  test("language changes do not alter telemetry section identifiers", async () => {
    await i18n.changeLanguage("ru");
    seedCsrfCookie();
    sessionStorage.setItem(
      "hoi4:product-telemetry:session:v1",
      "22222222-2222-4222-8222-222222222222",
    );
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await trackAnalysisEvent("analysis_section_viewed", "b".repeat(64), "production");
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.section).toBe("production");
    expect(body.eventName).toBe("analysis_section_viewed");
  });
});
