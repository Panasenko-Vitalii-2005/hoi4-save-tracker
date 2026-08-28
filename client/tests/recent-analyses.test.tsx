import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AnalyzerTab } from "../src/components/analyzer/AnalyzerTab";
import { RecentAnalyses } from "../src/components/analyzer/RecentAnalyses";

vi.mock("react-plotly.js", () => ({ default: () => null }));

const entry = {
  hash: "a".repeat(64),
  fileName: "autosave.hoi4",
  fileSizeBytes: 104534765,
  analyzedAt: "2026-08-28T10:30:00.000Z",
  gameDate: "1944.5.1",
  countryCount: 96,
  divisionCount: 3250,
  shipCount: 1539,
  navalLossCount: 993,
  hasPersistedResult: false,
};
const snapshot = {
  game_date: "1944.5.1",
  parse_seconds: 0.1,
  file_size_mb: 100,
  active_countries: 0,
  totals: {
    divisions: 0,
    ships: 0,
    aircraft: 0,
    manpowerInField: 0,
    effectiveMilitaryFactories: 0,
    effectiveCivilianFactories: 0,
    effectiveDockyards: 0,
  },
  by_country: [],
  equipment_by_country: {},
  world_equipment: {},
};

describe("Recent Analyses", () => {
  let root: Root;
  let container: HTMLDivElement;
  let historyRequests: Array<{
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }>;
  let analyzeRequests: Array<(response: Response) => void>;
  let openRequests: Array<{
    url: string;
    init?: RequestInit;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    historyRequests = [];
    analyzeRequests = [];
    openRequests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/analyze/recent")
          return new Promise<Response>((resolve, reject) =>
            historyRequests.push({ resolve, reject }),
          );
        if (url === "/api/analyze")
          return new Promise<Response>((resolve) =>
            analyzeRequests.push(resolve),
          );
        if (url.startsWith("/api/analyze/recent/") && url.endsWith("/result"))
          return new Promise<Response>((resolve, reject) =>
            openRequests.push({ url, init, resolve, reject }),
          );
        if (url === "/api/saves")
          return Promise.resolve(
            Response.json({ dir: "/saves", exists: true, files: [] }),
          );
        throw new Error(`Unexpected URL ${url}`);
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async (version = 0) => {
    await act(async () =>
      root.render(
        <RecentAnalyses refreshVersion={version} onOpen={() => {}} />,
      ),
    );
  };
  const respond = async (index: number, items: unknown[] = []) => {
    await act(async () =>
      historyRequests[index].resolve(Response.json({ items })),
    );
  };
  const section = () =>
    container.querySelector('[aria-label="Recent Analyses"]')!;
  const upload = async () => {
    const picker =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(picker.disabled).toBe(false);
    await act(async () => {
      Object.defineProperty(picker, "files", {
        configurable: true,
        value: [new File(["HOI4txt"], "autosave.hoi4")],
      });
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  test("loads with a quiet loading state and then an empty state", async () => {
    await render();
    expect(historyRequests).toHaveLength(1);
    expect(section().getAttribute("aria-busy")).toBe("true");
    expect(section().textContent).toContain("Loading recent analyses");
    await respond(0);
    expect(section().getAttribute("aria-busy")).toBe("false");
    expect(section().textContent).toContain("No recent analyses yet.");
    expect(section().querySelector("table")).toBeNull();
  });

  test("renders metadata, locale timestamps and distinct same-name entries without hash or reopen action", async () => {
    await render();
    await respond(0, [entry, { ...entry, hash: "b".repeat(64) }]);
    expect(section().querySelectorAll("tbody tr")).toHaveLength(2);
    expect(section().textContent).toContain(entry.fileName);
    expect(section().textContent).toContain(entry.gameDate);
    expect(section().textContent).toContain((3250).toLocaleString());
    expect(section().textContent).toContain((1539).toLocaleString());
    expect(section().innerHTML).not.toContain(entry.hash);
    expect(section().querySelector("time")?.dateTime).toBe(entry.analyzedAt);
    expect(section().querySelector("button, a, [tabindex]")).toBeNull();
    expect(section().textContent).toContain(
      "Original save files are not stored",
    );
  });

  test.each(["network", "http", "malformed"])(
    "%s history failure is local and allows retry",
    async (kind) => {
      await render();
      await act(async () => {
        if (kind === "network")
          historyRequests[0].reject(new Error("private storage path"));
        else
          historyRequests[0].resolve(
            kind === "http"
              ? new Response("private storage path", { status: 500 })
              : Response.json({ items: null }),
          );
      });
      expect(section().textContent).toContain("You can still analyze saves.");
      expect(section().textContent).not.toContain("private");
      await act(async () =>
        section().querySelector<HTMLButtonElement>("button")!.click(),
      );
      expect(historyRequests).toHaveLength(2);
      await respond(1, [entry]);
      expect(section().textContent).toContain(entry.fileName);
      expect(section().textContent).not.toContain("unavailable");
    },
  );

  test("history loading does not disable analysis and success refreshes it without page reload", async () => {
    await act(async () => root.render(<AnalyzerTab />));
    await upload();
    expect(analyzeRequests).toHaveLength(1);
    expect(historyRequests).toHaveLength(1);
    await act(async () => analyzeRequests[0](Response.json(snapshot)));
    expect(historyRequests).toHaveLength(2);
    await respond(1, [entry]);
    await respond(0); // An old response must not erase the refreshed list.
    expect(section().textContent).toContain(entry.fileName);
    expect(
      container.querySelector(".analyzer-view-date strong")?.textContent,
    ).toBe(snapshot.game_date);
  });

  test("history errors do not disable analysis or overwrite its successful result", async () => {
    await act(async () => root.render(<AnalyzerTab />));
    await act(async () =>
      historyRequests[0].reject(new Error("history offline")),
    );
    await upload();
    await act(async () => analyzeRequests[0](Response.json(snapshot)));
    await act(async () =>
      historyRequests[1].reject(new Error("still offline")),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "✓ autosave.hoi4",
    );
    expect(
      container.querySelector(".analyzer-view-date strong")?.textContent,
    ).toBe(snapshot.game_date);
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled,
    ).toBe(false);
  });

  test("failed analysis does not refresh recent history", async () => {
    await act(async () => root.render(<AnalyzerTab />));
    await respond(0);
    await upload();
    await act(async () =>
      analyzeRequests[0](new Response("busy", { status: 503 })),
    );
    expect(historyRequests).toHaveLength(1);
  });

  const openButton = () =>
    section().querySelector<HTMLButtonElement>(
      '[aria-label="Open analysis autosave.hoi4"]',
    )!;
  const resultDate = () =>
    container.querySelector(".analyzer-view-date strong")?.textContent;
  const withAvailableResult = async () => {
    await act(async () => root.render(<AnalyzerTab />));
    await respond(0, [{ ...entry, hasPersistedResult: true }]);
  };
  const opened = async () => {
    await withAvailableResult();
    await act(async () => openButton().click());
    await act(async () => openRequests[0].resolve(Response.json(snapshot)));
  };

  test("only explicitly available records offer native Open result buttons and hashes remain hidden", async () => {
    await render();
    await respond(0, [
      { ...entry, hasPersistedResult: true },
      { ...entry, hash: "b".repeat(64) },
      { ...entry, hash: "c".repeat(64), hasPersistedResult: undefined },
    ]);
    expect(section().querySelectorAll("tbody button")).toHaveLength(1);
    expect(openButton().textContent).toBe("Open result");
    expect(openButton().disabled).toBe(false);
    expect(section().innerHTML).not.toContain(entry.hash);
    expect(section().textContent).not.toMatch(
      /Open save|Load save|Download save/,
    );
  });

  test("Open fetches the persisted endpoint once with its own loading state without uploading", async () => {
    await withAvailableResult();
    await act(async () => {
      openButton().click();
      openButton().click();
    });
    expect(openRequests).toHaveLength(1);
    expect(openRequests[0].url).toBe(
      `/api/analyze/recent/${entry.hash}/result`,
    );
    expect(analyzeRequests).toHaveLength(0);
    expect(openButton().disabled).toBe(true);
    expect(section().textContent).toContain("Opening saved analysis");
    expect(section().querySelector("tbody tr")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled,
    ).toBe(false);
  });

  test("successful reopen uses existing result presentation and preserves original parse timing", async () => {
    await opened();
    expect(resultDate()).toBe(snapshot.game_date);
    expect(container.textContent).toContain("Original parse: 0.1s");
    expect(openButton().disabled).toBe(false);
    expect(historyRequests).toHaveLength(1); // Opening is not a new analysis.
    expect(analyzeRequests).toHaveLength(0);
    await act(async () => openButton().click());
    expect(resultDate()).toBe(snapshot.game_date);
    await act(async () =>
      openRequests[1].resolve(
        Response.json({ ...snapshot, game_date: "1945.1.1" }),
      ),
    );
    expect(resultDate()).toBe("1945.1.1");
  });

  test.each(["network", "server", "non-json", "malformed"])(
    "%s reopen failure is safe and leaves current result intact",
    async (kind) => {
      await opened();
      await act(async () => openButton().click());
      await act(async () => {
        const secret = "C:/private/storage stack gzip error";
        if (kind === "network") openRequests[1].reject(new Error(secret));
        else
          openRequests[1].resolve(
            kind === "server"
              ? new Response(secret, { status: 500 })
              : kind === "non-json"
                ? new Response(secret)
                : Response.json({}),
          );
      });
      expect(resultDate()).toBe(snapshot.game_date);
      expect(section().textContent).toContain(
        "Could not open the saved analysis",
      );
      expect(section().textContent).not.toMatch(/private|stack|gzip/);
      expect(openButton().disabled).toBe(false);
      expect(historyRequests).toHaveLength(1);
    },
  );

  test.each([404, 410])(
    "unavailable HTTP %i refreshes history and removes stale Open without erasing the result",
    async (code) => {
      await opened();
      await act(async () => openButton().click());
      await act(async () =>
        openRequests[1].resolve(new Response("private", { status: code })),
      );
      expect(resultDate()).toBe(snapshot.game_date);
      expect(section().textContent).toContain(
        "The saved analysis result is no longer available.",
      );
      expect(historyRequests).toHaveLength(2);
      await respond(1, [entry]);
      expect(openButton()).toBeNull();
    },
  );

  test("a new upload supersedes an in-flight Open, whose late success cannot replace the new result", async () => {
    await opened();
    await act(async () => openButton().click());
    await upload();
    expect(openRequests[1].init?.signal?.aborted).toBe(true);
    expect(openButton().disabled).toBe(true);
    await act(async () =>
      analyzeRequests[0](Response.json({ ...snapshot, game_date: "1946.1.1" })),
    );
    await act(async () =>
      openRequests[1].resolve(
        Response.json({ ...snapshot, game_date: "1936.1.1" }),
      ),
    );
    expect(resultDate()).toBe("1946.1.1");
    expect(section().textContent).not.toContain("Could not open");
  });

  test("a superseded Open failure does not alter upload status or show a stale error", async () => {
    await withAvailableResult();
    await act(async () => openButton().click());
    await upload();
    await act(async () => openRequests[0].reject(new Error("aborted")));
    expect(section().textContent).not.toContain("Could not open");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Uploading and analyzing",
    );
    await act(async () => analyzeRequests[0](Response.json(snapshot)));
    expect(resultDate()).toBe(snapshot.game_date);
  });

  test("unmount aborts pending Open", async () => {
    await withAvailableResult();
    await act(async () => openButton().click());
    await act(async () => root.render(null));
    expect(openRequests[0].init?.signal?.aborted).toBe(true);
    await act(async () => openRequests[0].resolve(Response.json(snapshot)));
    expect(container.textContent).toBe("");
  });
});
