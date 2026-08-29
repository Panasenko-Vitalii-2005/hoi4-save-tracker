import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "../src/App";
import { RecentAnalyses } from "../src/components/analyzer/RecentAnalyses";

vi.mock("react-plotly.js", () => ({ default: () => null }));

const publicId = "AbCdEfGhIjKlMnOpQrStUv";
const hash = "a".repeat(64);
const entry = {
  hash,
  fileName: "Vitalii-private-save.hoi4",
  fileSizeBytes: 1024,
  analyzedAt: "2026-08-28T10:30:00.000Z",
  gameDate: "1944.5.1",
  countryCount: 96,
  divisionCount: 3250,
  shipCount: 1539,
  navalLossCount: 993,
  hasPersistedResult: true,
  pinned: false,
};

function snapshot(gameDate = "1944.5.1") {
  return {
    game_date: gameDate,
    parse_seconds: 3.2,
    file_size_mb: 100,
    active_countries: 96,
    totals: {
      divisions: 3250,
      ships: 1539,
      aircraft: 53095,
      manpowerInField: 0,
      manpowerCasualties: null,
      warCasualties: [],
      militaryFactories: 0,
      civilianFactories: 0,
      dockyards: 0,
      occupiedMilitaryFactories: 0,
      subjectMilitaryFactories: 0,
      effectiveOwnMilitaryFactories: 0,
      effectiveMilitaryFactories: 0,
      subjectCivilianFactories: 0,
      occupiedCivilianFactories: 0,
      ownedCivilianFactories: 0,
      tradeCivilianFactories: 0,
      effectiveCivilianFactories: 0,
      shipProductionDockyards: 0,
      repairDockyards: 0,
      effectiveDockyards: 0,
    },
    by_country: [],
    equipment_by_country: {},
    world_equipment: {},
    stockpileSummaries: [],
    militaryProductionSummaries: [],
    divisionSummaries: [],
    divisionTemplateCatalog: [],
    divisionEquipmentCatalog: [],
    armyHierarchySummaries: [],
    navalLosses: [],
    navalLossSummaries: [],
    navalKills: [],
    navalKillSummaries: [],
    navalKillerShipSummaries: [],
  };
}

describe("Recent Analyses Share action", () => {
  let root: Root;
  let container: HTMLDivElement;
  let shareRequests: Array<{
    method: string;
    resolve: (response: Response) => void;
  }>;
  let historyItems: typeof entry[];
  let clipboard: ReturnType<typeof vi.fn>;
  let clipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    shareRequests = [];
    historyItems = [entry];
    clipboard = vi.fn(() => Promise.resolve());
    clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/analyze/recent")
          return Promise.resolve(Response.json({ items: historyItems }));
        if (url === `/api/analyze/recent/${hash}/share`)
          return new Promise<Response>((resolve) =>
            shareRequests.push({ method: init?.method ?? "GET", resolve }),
          );
        if (url.startsWith("/api/analyze/recent/") && init?.method === "DELETE")
          return Promise.resolve(Response.json({ items: [] }));
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
    if (clipboardDescriptor)
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
    vi.unstubAllGlobals();
  });

  const render = async () => {
    await act(async () =>
      root.render(<RecentAnalyses refreshVersion={0} onOpen={() => {}} />),
    );
  };
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) ??
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === label,
    )!;
  const openDialog = async () => {
    await act(async () => button(`Share analysis ${entry.fileName}`).click());
    return container.querySelector<HTMLElement>('[role="dialog"]')!;
  };
  const createLink = async () => {
    const dialog = await openDialog();
    await act(async () => button("Create public link").click());
    await act(async () =>
      shareRequests.at(-1)!.resolve(
        Response.json({ id: publicId, path: `/share/${publicId}` }),
      ),
    );
    return dialog;
  };

  test("Share is available only for a durably persisted result", async () => {
    historyItems = [entry, { ...entry, hash: "b".repeat(64), hasPersistedResult: false }];
    await render();
    expect(container.querySelectorAll('[aria-label^="Share analysis"]')).toHaveLength(1);
  });

  test("first Share opens an explicit confirmation without an API call", async () => {
    await render();
    const dialog = await openDialog();
    expect(dialog.textContent).toContain("Create a public, read-only link");
    expect(shareRequests).toHaveLength(0);
    expect(button("Create public link")).toBe(document.activeElement);
  });

  test("confirmation explains anyone-with-link access and filename privacy", async () => {
    await render();
    const dialog = await openDialog();
    expect(dialog.textContent).toContain("Anyone with the link");
    expect(dialog.textContent).toContain("original save file");
    expect(dialog.textContent).toContain("private filename");
  });

  test("Cancel and Escape close confirmation without creating a share", async () => {
    await render();
    await openDialog();
    await act(async () => button("Cancel").click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await openDialog();
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(shareRequests).toHaveLength(0);
  });

  test("successful Share renders a selectable URL from browser origin without raw hash", async () => {
    await render();
    await createLink();
    const input = container.querySelector<HTMLInputElement>(
      'input[readonly][id="public-share-url"]',
    )!;
    expect(input.value).toBe(
      new URL(`/share/${publicId}`, window.location.origin).toString(),
    );
    expect(container.textContent).toContain("Public link created");
    expect(container.querySelector('[role="dialog"]')?.innerHTML).not.toContain(
      hash,
    );
  });

  test("Copy uses the Clipboard API with the user-facing route", async () => {
    await render();
    await createLink();
    await act(async () => button("Copy link").click());
    expect(clipboard).toHaveBeenCalledWith(
      new URL(`/share/${publicId}`, window.location.origin).toString(),
    );
    expect(container.textContent).toContain("Public link copied");
  });

  test("clipboard failure leaves URL visible and selectable", async () => {
    clipboard.mockRejectedValueOnce(new Error("denied"));
    await render();
    await createLink();
    await act(async () => button("Copy link").click());
    expect(container.textContent).toContain("Select and copy the URL");
    expect(container.querySelector<HTMLInputElement>("#public-share-url")?.value).toContain(
      publicId,
    );
  });

  test("reopening Share in the same private view reuses the existing link", async () => {
    await render();
    await createLink();
    await act(async () => button("Close share dialog").click());
    await openDialog();
    expect(container.querySelector("#public-share-url")).not.toBeNull();
    expect(container.textContent).not.toContain("Create public link");
    expect(shareRequests).toHaveLength(1);
  });

  test("Open public view is a native link to the frontend route", async () => {
    await render();
    await createLink();
    const open = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(
      (item) => item.textContent === "Open public view",
    )!;
    expect(open.getAttribute("href")).toBe(`/share/${publicId}`);
    expect(open.target).toBe("_blank");
  });

  test("cancelled revoke sends no request and keeps the URL active", async () => {
    await render();
    await createLink();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await act(async () => button("Revoke link").click());
    expect(shareRequests).toHaveLength(1);
    expect(container.querySelector("#public-share-url")).not.toBeNull();
  });

  test("confirmed revoke uses the dedicated action and makes private link state inactive", async () => {
    await render();
    await createLink();
    await act(async () => button("Revoke link").click());
    expect(shareRequests[1].method).toBe("DELETE");
    await act(async () =>
      shareRequests[1].resolve(Response.json({ revoked: true })),
    );
    expect(container.textContent).toContain("Public link revoked");
    expect(container.querySelector("#public-share-url")).toBeNull();
    await act(async () => button("Close share dialog").click());
    await openDialog();
    expect(container.textContent).toContain("Create public link");
  });

  test("failed create is safe, retryable and never renders backend text", async () => {
    await render();
    await openDialog();
    await act(async () => button("Create public link").click());
    await act(async () =>
      shareRequests[0].resolve(
        new Response("C:/private/share-store stack", { status: 503 }),
      ),
    );
    expect(container.textContent).toContain("Could not create");
    expect(
      container.querySelector('[role="dialog"] [role="status"]')?.textContent,
    ).not.toMatch(/private|stack/i);
    expect(button("Create public link").disabled).toBe(false);
  });

  test("malformed create response is rejected without showing an internal API URL", async () => {
    await render();
    await openDialog();
    await act(async () => button("Create public link").click());
    await act(async () =>
      shareRequests[0].resolve(
        Response.json({ id: hash, path: `/api/share/${hash}` }),
      ),
    );
    expect(container.textContent).toContain("Could not create");
    expect(container.querySelector("#public-share-url")).toBeNull();
  });

  test("Delete confirmation distinguishes private history from an active public link", async () => {
    await render();
    await act(async () => button(`Delete analysis ${entry.fileName}`).click());
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("public link will remain available"),
    );
  });
});

describe("public /share route", () => {
  let root: Root;
  let container: HTMLDivElement;
  let requests: Array<{
    url: string;
    init?: RequestInit;
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }>;
  let originalTitle: string;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    requests = [];
    originalTitle = document.title;
    window.history.replaceState({}, "", `/share/${publicId}`);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) =>
          requests.push({ url, init, resolve, reject }),
        ),
      ),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState({}, "", "/");
    document.title = originalTitle;
    vi.unstubAllGlobals();
  });

  const render = async () => {
    await act(async () => root.render(<App />));
  };
  const resolve = async (body: unknown = snapshot(), status = 200) => {
    await act(async () =>
      requests.at(-1)!.resolve(Response.json(body, { status })),
    );
  };

  test("direct deep link fetches only the public API and starts in a loading state", async () => {
    await render();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/api/share/${publicId}`);
    expect(requests[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Loading shared analysis",
    );
  });

  test("valid public response reuses the existing analysis presentation", async () => {
    await render();
    await resolve();
    expect(container.textContent).toContain("HoI4 Save Analysis");
    expect(container.textContent).toContain("Campaign snapshot · Save date 1944.5.1");
    expect(container.querySelector(".analyzer-view-date strong")?.textContent).toBe(
      "1944.5.1",
    );
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  });

  test("public renderer contains no upload, Recent, Compare, Pin or Delete controls", async () => {
    await render();
    await resolve();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /Upload \.hoi4|Recent Analyses|Compare Saves|Open result|Pin analysis|Delete analysis/,
    );
  });

  test("public page never renders the original filename, raw hash or storage internals", async () => {
    await render();
    await resolve();
    expect(container.innerHTML).not.toContain(entry.fileName);
    expect(container.innerHTML).not.toContain(hash);
    expect(container.textContent).not.toMatch(/sourceOffset|json\.gz|temporaryPath|Worker/);
  });

  test("invalid route identifier fails locally without an API or filesystem-shaped request", async () => {
    window.history.replaceState({}, "", "/share/not-valid");
    await render();
    expect(requests).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Shared analysis unavailable",
    );
  });

  test.each([404, 410, 500])(
    "HTTP %i renders one safe unavailable state without backend details",
    async (status) => {
      await render();
      await act(async () =>
        requests[0].resolve(
          new Response("C:/private/result.json.gz STACK", { status }),
        ),
      );
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Shared analysis unavailable",
      );
      expect(container.textContent).not.toMatch(/private|STACK|json\.gz/);
    },
  );

  test("network and malformed-result failures are safe", async () => {
    await render();
    await act(async () => requests[0].reject(new Error("private stack")));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent === "Try again")!
        .click(),
    );
    await resolve({ game_date: "1944.5.1", privatePath: "secret" });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/private stack|privatePath|secret/);
  });

  test("Try again performs only an explicit public-result retry", async () => {
    await render();
    await resolve({}, 500);
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((item) => item.textContent === "Try again")!
        .click(),
    );
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toBe(`/api/share/${publicId}`);
    await resolve(snapshot("1945.1.1"));
    expect(container.querySelector(".analyzer-view-date strong")?.textContent).toBe(
      "1945.1.1",
    );
  });

  test("popstate navigation clears stale details before loading another share", async () => {
    await render();
    await resolve();
    const second = "ZyXwVuTsRqPoNmLkJiHgFe";
    await act(async () => {
      window.history.pushState({}, "", `/share/${second}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(requests[1].url).toBe(`/api/share/${second}`);
    expect(container.querySelector(".analyzer-view-date strong")).toBeNull();
    expect(container.textContent).toContain("Loading shared analysis");
    await resolve(snapshot("1946.1.1"));
    expect(container.textContent).toContain("1946.1.1");
  });

  test("fresh remount on the same deep link fetches and renders again", async () => {
    await render();
    await resolve();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(requests).toHaveLength(2);
    await resolve();
    expect(container.textContent).toContain("Campaign snapshot");
  });

  test("public document title is neutral and game-derived", async () => {
    await render();
    expect(document.title).toBe("HoI4 Save Analysis");
    await resolve();
    expect(document.title).toBe("HoI4 Save Analysis — 1944.5.1");
    expect(document.title).not.toContain(entry.fileName);
  });

  test("public tabs remain native keyboard-focusable controls", async () => {
    await render();
    await resolve();
    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBeGreaterThan(1);
    expect(tabs[0].tabIndex).toBe(0);
    tabs[1].focus();
    expect(document.activeElement).toBe(tabs[1]);
    await act(async () => tabs[1].click());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });
});
