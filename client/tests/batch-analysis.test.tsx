import { createHash } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  BatchAnalysisPanel,
  SNAPSHOTTER_DOWNLOAD_PATH,
} from "../src/components/analyzer/BatchAnalysisPanel";
import { seedCsrfCookie } from "./auth-fixture";
import { i18n } from "../src/i18n";

function hash(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function save(name: string, contents: string): File {
  const file = new File([contents], name);
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () => Uint8Array.from(Buffer.from(contents)).buffer,
  });
  return file;
}

function folderSave(name: string, contents: string): File {
  const file = save(name, contents);
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: `snapshots/${name}`,
  });
  return file;
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  throw new Error("Timed out waiting for batch UI");
}

describe("BatchAnalysisPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
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

  const input = () =>
    container.querySelector<HTMLInputElement>(
      'input[type="file"][multiple]',
    )!;
  const folderInput = () =>
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Select a campaign snapshot folder"]',
    )!;
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === label,
    )!;
  const select = async (files: File[]) => {
    Object.defineProperty(input(), "files", {
      configurable: true,
      value: files,
    });
    await act(async () =>
      input().dispatchEvent(new Event("change", { bubbles: true })),
    );
    await waitFor(
      () =>
        container
          .querySelector(".batch-analysis-panel")
          ?.getAttribute("data-phase") === "review",
    );
  };

  test("explains campaign import before files are selected", async () => {
    await act(async () => root.render(<BatchAnalysisPanel />));

    expect(container.textContent).toContain("Import campaign");
    expect(container.textContent).toContain("Select or drop multiple .hoi4 saves");
    expect(container.textContent).toContain("Already analyzed saves are skipped");
    expect(container.textContent).toContain("added to Campaign Trends");
    expect(button("Import Campaign")).toBeDefined();
    expect(button("Select snapshot folder")).toBeDefined();
    expect(input().multiple).toBe(true);
    expect(folderInput().hasAttribute("webkitdirectory")).toBe(true);
  });

  test("offers the canonical same-origin Windows snapshotter with safe English guidance", async () => {
    await act(async () => root.render(<BatchAnalysisPanel />));

    const onboarding = container.querySelector(".snapshotter-onboarding")!;
    const download = onboarding.querySelector<HTMLAnchorElement>("a[download]")!;
    expect(onboarding.textContent).toContain("Automatic campaign snapshots");
    expect(onboarding.textContent).toContain("Hearts of Iron IV overwrites autosaves");
    expect(download.textContent).toContain("Download Snapshotter for Windows");
    expect(download.getAttribute("href")).toBe(SNAPSHOTTER_DOWNLOAD_PATH);
    expect(download.getAttribute("download")).toBe("hoi4-save-snapshotter.ps1");
    expect(onboarding.textContent).toContain("OneDrive");
    expect(onboarding.textContent).toContain("File Properties → Unblock");
    expect(onboarding.textContent).toContain(
      "Unblock-File .\\hoi4-save-snapshotter.ps1",
    );
    expect(onboarding.textContent).not.toContain("-Patterns");
    expect(onboarding.textContent).not.toMatch(/panas|custom-projects/i);
  });

  test("fully localizes snapshotter onboarding in Russian", async () => {
    await i18n.changeLanguage("ru");
    await act(async () => root.render(<BatchAnalysisPanel />));

    const onboarding = container.querySelector(".snapshotter-onboarding")!;
    expect(onboarding.textContent).toContain("Автоматические снимки кампании");
    expect(onboarding.textContent).toContain("Скачать Snapshotter для Windows");
    expect(onboarding.textContent).toContain("Как использовать");
    expect(onboarding.textContent).toContain("OneDrive");
    expect(onboarding.textContent).toContain("25 файлов");
    expect(onboarding.textContent).not.toContain("Download Snapshotter");
  });

  test("samples a snapshot folder before sending only selected files into the existing batch flow", async () => {
    const files = Array.from({ length: 79 }, (_, index) => {
      const hour = String(15 + Math.floor(index / 60)).padStart(2, "0");
      const minute = String(index % 60).padStart(2, "0");
      return folderSave(
        `autosave_temp_2026-09-21_${hour}-${minute}-00.hoi4`,
        `snapshot-${index}`,
      );
    });
    const hashes = new Map(
      files.map((file, index) => [file.name, hash(`snapshot-${index}`)]),
    );
    const uploaded: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/analyze/batch/preflight")
        return Response.json({ knownHashes: [] }, { status: 201 });
      if (!(init?.body instanceof FormData)) throw new Error("Missing upload");
      const file = init.body.get("file") as File;
      uploaded.push(file.name);
      return Response.json(
        {
          hash: hashes.get(file.name),
          gameDate: "1944.5.1",
          campaignId: "campaign-a",
        },
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<BatchAnalysisPanel />));
    Object.defineProperty(folderInput(), "files", {
      configurable: true,
      value: files,
    });
    await act(async () =>
      folderInput().dispatchEvent(new Event("change", { bubbles: true })),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Snapshots found79");
    expect(container.textContent).toContain("Selected25");
    expect(container.textContent).toContain("Skipped54");
    expect(
      container.querySelector<HTMLSelectElement>(
        ".snapshot-folder-controls select",
      )?.value,
    ).toBe("25");

    await act(async () => button("Use selected snapshots").click());
    await waitFor(
      () =>
        container
          .querySelector(".batch-analysis-panel")
          ?.getAttribute("data-phase") === "review",
    );
    expect(container.textContent).toContain("25Selected");
    expect(uploaded).toEqual([]);

    await act(async () => button("Analyze 25 new saves").click());
    await waitFor(
      () =>
        uploaded.length === 25 &&
        container.textContent?.includes("Batch complete") === true,
    );
    expect(uploaded).toHaveLength(25);
    expect(uploaded[0]).toBe(files[0].name);
    expect(uploaded.at(-1)).toBe(files.at(-1)?.name);
  });

  test("recalculates folder sample counts and fully localizes the workflow", async () => {
    await i18n.changeLanguage("ru");
    await act(async () => root.render(<BatchAnalysisPanel />));
    const russianFolderInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Выбрать папку со снимками кампании"]',
    )!;
    const files = Array.from({ length: 18 }, (_, index) =>
      folderSave(
        `autosave_temp_2026-09-21_15-${String(index).padStart(2, "0")}-00.hoi4`,
        "x".repeat(index + 1),
      ),
    );
    Object.defineProperty(russianFolderInput, "files", {
      configurable: true,
      value: files,
    });
    await act(async () =>
      russianFolderInput.dispatchEvent(new Event("change", { bubbles: true })),
    );

    expect(button("Выбрать папку со снимками")).toBeDefined();
    expect(container.textContent).toContain("Найдено снимков18");
    expect(container.textContent).toContain("Выбрано18");
    expect(container.textContent).toContain("Пропущено0");
    expect(container.textContent).toContain("Объём выбранных файлов171 B");
    expect(container.textContent).toContain("Общий объём снимков171 B");
    expect(container.textContent).toContain("Рекомендуется");
    expect(container.textContent).toContain("Точные игровые даты");

    const target = container.querySelector<HTMLSelectElement>(
      ".snapshot-folder-controls select",
    )!;
    await act(async () => {
      target.value = "10";
      target.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Выбрано10");
    expect(container.textContent).toContain("Пропущено8");
    expect(container.textContent).toContain("Объём выбранных файлов95 B");
    expect(container.textContent).toContain("Общий объём снимков171 B");
  });

  test("reviews, deduplicates and sequentially processes files with isolated retry", async () => {
    const knownContents = "known";
    const firstContents = "first";
    const secondContents = "second";
    const knownHash = hash(knownContents);
    const firstHash = hash(firstContents);
    const secondHash = hash(secondContents);
    let firstAttempts = 0;
    let active = 0;
    let maxActive = 0;
    const batchNames: string[] = [];
    const historyChanged = vi.fn();
    const running = vi.fn();
    const navigate = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/analyze/batch/preflight")
          return Response.json({ knownHashes: [knownHash] }, { status: 201 });
        expect(url).toBe("/api/analyze?response=batch");
        if (!(init?.body instanceof FormData))
          throw new Error("Missing upload");
        active++;
        maxActive = Math.max(maxActive, active);
        const file = init.body.get("file") as File;
        batchNames.push(file.name);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active--;
        if (file.name === "first.hoi4" && firstAttempts++ === 0)
          return Response.json(
            { code: "INVALID_SAVE", message: "C:/private/STACK" },
            { status: 400 },
          );
        const fileHash = file.name === "first.hoi4" ? firstHash : secondHash;
        return Response.json(
          { hash: fileHash, gameDate: "1944.5.1", campaignId: "campaign-a" },
          { status: 201 },
        );
      }),
    );

    await act(async () =>
      root.render(
        <BatchAnalysisPanel
          onRunningChange={running}
          onHistoryChanged={historyChanged}
          onNavigateToCampaignTrends={navigate}
        />,
      ),
    );
    expect(input().multiple).toBe(true);
    await select([
      save("known.hoi4", knownContents),
      save("first.hoi4", firstContents),
      save("second.hoi4", secondContents),
      save("duplicate.hoi4", firstContents),
      save("wrong.txt", "wrong"),
      save("empty.hoi4", ""),
    ]);

    expect(container.textContent).toContain("6Selected");
    expect(container.textContent).toContain("1Already analyzed");
    expect(container.textContent).toContain("2New");
    expect(container.textContent).toContain("2Invalid");
    expect(container.textContent).toContain("1Duplicates skipped");
    expect(batchNames).toEqual([]);

    await act(async () => button("Analyze 2 new saves").click());
    await waitFor(
      () => container.textContent?.includes("Batch complete") === true,
    );
    expect(batchNames).toEqual(["first.hoi4", "second.hoi4"]);
    expect(maxActive).toBe(1);
    expect(container.textContent).toContain(
      "Completed: 1 · Failed: 1",
    );
    expect(container.textContent).toContain(
      "This is not a valid Hearts of Iron IV save",
    );
    expect(container.textContent).not.toMatch(/private|STACK/);
    expect(historyChanged).toHaveBeenCalledTimes(1);
    expect(running.mock.calls).toEqual([[true], [false]]);

    await act(async () => button("Retry failed").click());
    await waitFor(
      () =>
        batchNames.length === 3 &&
        container.textContent?.includes("Failed: 0") === true,
    );
    expect(batchNames).toEqual(["first.hoi4", "second.hoi4", "first.hoi4"]);
    expect(historyChanged).toHaveBeenCalledTimes(2);
    await act(async () => button("View Campaign Trends").click());
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  test("localizes completed analysis navigation actions in Russian", async () => {
    const contents = "campaign";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/analyze/batch/preflight")
          return Response.json({ knownHashes: [] }, { status: 201 });
        return Response.json(
          { hash: hash(contents), gameDate: "1944.5.1", campaignId: "campaign-a" },
          { status: 201 },
        );
      }),
    );
    await i18n.changeLanguage("ru");
    await act(async () =>
      root.render(<BatchAnalysisPanel onNavigateToCampaignTrends={() => undefined} />),
    );
    await select([save("campaign.hoi4", contents)]);
    await act(async () => button("Проанализировать 1 новое сохранение").click());
    await waitFor(() => container.textContent?.includes("Пакетный анализ завершён") === true);
    expect(button("Посмотреть недавние анализы")).toBeDefined();
    expect(button("Открыть динамику кампании")).toBeDefined();
  });

  test("cancel stops queued uploads while allowing the current file to finish", async () => {
    const files = [save("one.hoi4", "one"), save("two.hoi4", "two")];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const analyzed: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/analyze/batch/preflight")
          return Response.json({ knownHashes: [] }, { status: 201 });
        if (!(init?.body instanceof FormData))
          throw new Error("Missing upload");
        const file = init.body.get("file") as File;
        analyzed.push(file.name);
        await pending;
        return Response.json(
          {
            hash: hash(file.name === "one.hoi4" ? "one" : "two"),
            gameDate: "1944.5.1",
            campaignId: null,
          },
          { status: 201 },
        );
      }),
    );
    await act(async () => root.render(<BatchAnalysisPanel />));
    await select(files);
    await act(async () => button("Analyze 2 new saves").click());
    await waitFor(() => analyzed.length === 1);
    await act(async () => button("Cancel remaining").click());
    release();
    await waitFor(
      () => container.textContent?.includes("Batch complete") === true,
    );
    expect(analyzed).toEqual(["one.hoi4"]);
    expect(container.textContent).toContain("Cancelled");
  });

  test("network failure stays local, later files continue, and Retry failed retries only that file", async () => {
    const attempted: string[] = [];
    let firstAttempt = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/analyze/batch/preflight")
          return Response.json({ knownHashes: [] });
        if (!(init?.body instanceof FormData))
          throw new Error("Missing upload form");
        const file = init.body.get("file") as File;
        attempted.push(file.name);
        if (file.name === "offline.hoi4" && firstAttempt) {
          firstAttempt = false;
          throw new Error("Worker stack C:/private/upload");
        }
        return Response.json(
          {
            hash: hash(file.name === "offline.hoi4" ? "offline" : "good"),
            gameDate: "1944.5.1",
            campaignId: null,
          },
          { status: 201 },
        );
      }),
    );
    await act(async () => root.render(<BatchAnalysisPanel />));
    await select([
      save("offline.hoi4", "offline"),
      save("good.hoi4", "good"),
    ]);
    await act(async () => button("Analyze 2 new saves").click());
    await waitFor(() => container.textContent?.includes("Batch complete") === true);

    expect(attempted).toEqual(["offline.hoi4", "good.hoi4"]);
    expect(container.textContent).toContain("Completed: 1 · Failed: 1");
    expect(container.textContent).toContain("Cannot reach the analyzer service");
    expect(container.textContent).not.toMatch(/Worker|private/);

    await act(async () => button("Retry failed").click());
    await waitFor(() => container.textContent?.includes("Failed: 0") === true);
    expect(attempted).toEqual([
      "offline.hoi4",
      "good.hoi4",
      "offline.hoi4",
    ]);
  });

  test("preflight network failure uploads nothing and can be retried", async () => {
    let preflightAttempt = 0;
    let uploads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/analyze/batch/preflight") {
          if (preflightAttempt++ === 0)
            throw new Error("C:/private/preflight");
          return Response.json({ knownHashes: [] });
        }
        uploads++;
        return Response.json({});
      }),
    );
    await act(async () => root.render(<BatchAnalysisPanel />));
    await select([save("one.hoi4", "one")]);
    expect(container.textContent).toContain("Cannot reach the analyzer service");
    expect(container.textContent).not.toContain("private");
    expect(uploads).toBe(0);

    await act(async () => button("Try again").click());
    await waitFor(() => button("Analyze 1 new save") !== undefined);
    expect(uploads).toBe(0);
  });

  test("renders a compact accessible 100-file known batch without uploads", async () => {
    const files = Array.from({ length: 100 }, (_, index) =>
      save(`autosave_${index}.hoi4`, `save-${index}`),
    );
    const allHashes = new Set(files.map((_, index) => hash(`save-${index}`)));
    let uploadCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/analyze/batch/preflight") {
          const body = JSON.parse(String(init?.body)) as { hashes: string[] };
          return Response.json(
            {
              knownHashes: body.hashes.filter((value) => allHashes.has(value)),
            },
            { status: 201 },
          );
        }
        uploadCalls++;
        return Response.json({}, { status: 500 });
      }),
    );
    await act(async () => root.render(<BatchAnalysisPanel />));
    await select(files);
    expect(container.textContent).toContain("100Selected");
    expect(container.textContent).toContain("100Already analyzed");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(100);
    expect(
      container
        .querySelector('[aria-label="Batch save files"]')
        ?.getAttribute("tabindex"),
    ).toBe("0");
    expect(uploadCalls).toBe(0);
  });
});
