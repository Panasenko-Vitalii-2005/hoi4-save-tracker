import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RecentAnalyses } from "../src/components/analyzer/RecentAnalyses";
import { AnalyzerTab } from "../src/components/analyzer/AnalyzerTab";
import type {
  AnalysisComparisonDto,
  CountryComparison,
  NumericDiff,
} from "../src/types/analysis-comparison";
import type { RecentAnalysis } from "../src/types";

vi.mock("react-plotly.js", () => ({ default: () => null }));

const entry = (
  letter: string,
  fileName: string,
  available = true,
): RecentAnalysis => ({
  hash: letter.repeat(64),
  fileName,
  hasPersistedResult: available,
  pinned: false,
  fileSizeBytes: 100,
  analyzedAt: "2026-08-28T10:00:00Z",
  gameDate: "1944.5.1",
  countryCount: 1,
  divisionCount: 10,
  shipCount: 2,
  navalLossCount: 1,
});
const entries = [
  entry("a", "Base.hoi4"),
  entry("b", "Target.hoi4"),
  entry("c", "Third.hoi4"),
  entry("d", "Unavailable.hoi4", false),
];
const diff = (before: number | null, after: number | null): NumericDiff => ({
  before,
  after,
  delta: before === null || after === null ? null : after - before,
});
const row = (
  tag: string,
  hasChanges = false,
  status: CountryComparison["status"] = "unchanged",
): CountryComparison => ({
  tag,
  hasChanges,
  status,
  effectiveMilitaryFactories: diff(10, hasChanges ? 12 : 10),
  effectiveCivilianFactories: diff(8, hasChanges ? 6 : 8),
  effectiveDockyards: diff(0, 0),
  divisions: diff(1, 1),
  manpowerInField: diff(100, 100),
  ships: diff(null, hasChanges ? 2 : null),
  calculatedWarCasualtiesTotal: diff(0, 0),
});
const response = (
  base = entries[0].hash,
  target = entries[1].hash,
): AnalysisComparisonDto => ({
  baseHash: base,
  targetHash: target,
  baseGameDate: "1944.5.1",
  targetGameDate: "1944.6.1",
  hasChanges: true,
  summary: {
    activeCountries: diff(2, 3),
    divisions: diff(10, 15),
    manpowerInField: diff(1000, 1100),
    aircraft: diff(10, 10),
    ships: diff(5, 3),
    navalLossCount: diff(1, 2),
  },
  countries: [
    row("GER", true),
    row("DEN"),
    row("DNK"),
    row("D04", true, "added"),
    row("ENG", true, "removed"),
  ],
});

describe("Save comparison UI", () => {
  let root: Root;
  let container: HTMLDivElement;
  let requests: {
    url: string;
    init?: RequestInit;
    resolve: (response: Response) => void;
  }[];
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/saves")
          return Promise.resolve(
            Response.json({ dir: "/saves", exists: true, files: [] }),
          );
        return new Promise<Response>((resolve) =>
          requests.push({ url, init, resolve }),
        );
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
  const render = async (analyzer = false) => {
    await act(async () =>
      root.render(
        analyzer ? (
          <AnalyzerTab />
        ) : (
          <RecentAnalyses refreshVersion={0} onOpen={() => {}} />
        ),
      ),
    );
    await act(async () =>
      requests[0].resolve(Response.json({ items: entries })),
    );
  };
  const select = async (id: string, value: string) => {
    await act(async () => {
      const control = container.querySelector<HTMLSelectElement>(`#${id}`)!;
      control.value = value;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    )!;
  const click = async (text: string) => {
    await act(async () => button(text).click());
  };
  const comparisons = () =>
    requests.filter((r) => r.url.startsWith("/api/analyze/compare?"));
  const choose = async () => {
    await select("compare-base", entries[0].hash);
    await select("compare-target", entries[1].hash);
  };
  const finish = async (data = response()) => {
    await act(async () => comparisons().at(-1)!.resolve(Response.json(data)));
  };
  const results = () =>
    container.querySelector('[aria-label="Comparison results"]')!;
  const countryRows = () => [...results().querySelectorAll("tbody tr")];

  test("two explicit slots offer only available analyses and require both selections", async () => {
    await render();
    const controls = container.querySelector('[aria-label="Compare saves"]')!;
    expect(controls.querySelectorAll("select")).toHaveLength(2);
    expect(controls.textContent).not.toContain("Unavailable.hoi4");
    expect(controls.textContent).toContain("Base analysis");
    expect(controls.textContent).toContain("Target analysis");
    expect(button("Compare").disabled).toBe(true);
    await select("compare-base", entries[0].hash);
    expect(button("Compare").disabled).toBe(true);
    await select("compare-target", entries[1].hash);
    expect(button("Compare").disabled).toBe(false);
    // A third choice replaces only the explicitly chosen slot; never creates a third side.
    await select("compare-target", entries[2].hash);
    expect(
      (container.querySelector("#compare-base") as HTMLSelectElement).value,
    ).toBe(entries[0].hash);
    expect(
      (container.querySelector("#compare-target") as HTMLSelectElement).value,
    ).toBe(entries[2].hash);
  });

  test("Swap reverses visible direction and the exact API query", async () => {
    await render();
    await choose();
    await click("Swap");
    await click("Compare");
    const query = new URL(comparisons()[0].url, "http://localhost")
      .searchParams;
    expect(query.get("base")).toBe(entries[1].hash);
    expect(query.get("target")).toBe(entries[0].hash);
    await finish(response(entries[1].hash, entries[0].hash));
    const names = [
      ...results().querySelectorAll(".comparison-direction strong"),
    ].map((n) => n.textContent);
    expect(names).toEqual(["Target.hoi4", "Base.hoi4"]);
  });

  test("loading uses a synchronous duplicate guard and accessible busy status", async () => {
    await render();
    await choose();
    const compare = button("Compare");
    await act(async () => {
      compare.click();
      compare.click();
    });
    expect(comparisons()).toHaveLength(1);
    expect(button("Comparing…").disabled).toBe(true);
    expect(
      container
        .querySelector('[aria-label="Compare saves"]')
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    await finish();
    expect(button("Compare").disabled).toBe(false);
  });

  test("changing selection aborts the old request and ignores its late response", async () => {
    await render();
    await choose();
    await click("Compare");
    const old = comparisons()[0];
    await click("Swap");
    expect(old.init?.signal?.aborted).toBe(true);
    await click("Compare");
    await finish(response(entries[1].hash, entries[0].hash));
    await act(async () => old.resolve(Response.json(response())));
    expect(
      results().querySelector(".comparison-direction strong")?.textContent,
    ).toBe("Target.hoi4");
  });

  test("unmount aborts comparison and late completion cannot restore UI", async () => {
    await render();
    await choose();
    await click("Compare");
    const old = comparisons()[0];
    await act(async () => root.render(null));
    expect(old.init?.signal?.aborted).toBe(true);
    await act(async () => old.resolve(Response.json(response())));
    expect(container.textContent).toBe("");
  });

  test("renders global metrics and positive, negative, zero and unavailable deltas neutrally", async () => {
    await render();
    await choose();
    await click("Compare");
    await finish();
    expect(results().textContent).toContain("Recorded naval losses");
    expect(results().textContent).toContain("10 → 15");
    expect(results().textContent).toContain("+5");
    const cells = countryRows()[0].querySelectorAll("td");
    expect(cells[1].textContent).toBe("10 → 12+2");
    expect(cells[2].textContent).toBe("8 → 6-2");
    expect(cells[3].textContent).toBe("0 → 00");
    expect(cells[6].textContent).toBe("— → 2—");
    expect(results().textContent).not.toContain("+0");
    expect(results().textContent).not.toContain(entries[0].hash);
    expect(results().textContent).not.toContain(entries[1].hash);
  });

  test("changed-only is default; All countries retains aliases with identical display names", async () => {
    await render();
    await choose();
    await click("Compare");
    await finish();
    expect(
      (
        container.querySelector(
          "#comparison-country-scope",
        ) as HTMLSelectElement
      ).value,
    ).toBe("changed");
    expect(countryRows()).toHaveLength(3);
    expect(results().textContent).toContain("Added");
    expect(results().textContent).toContain("Removed");
    expect(results().textContent).toContain("Germany");
    expect(results().textContent).toContain("United Kingdom");
    await select("comparison-country-scope", "all");
    expect(countryRows()).toHaveLength(5);
    expect(
      countryRows().filter((r) => r.textContent?.includes("Denmark")),
    ).toHaveLength(2);
  });

  test("country search reuses country names and supports dynamic tags", async () => {
    await render();
    await choose();
    await click("Compare");
    await finish();
    const search = async (text: string) => {
      const input = container.querySelector<HTMLInputElement>(
        "#comparison-country-search",
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await search("gerMAny");
    expect(countryRows()).toHaveLength(1);
    await search("d04");
    expect(countryRows()[0].textContent).toContain("D04");
    await search("nonexistent");
    expect(results().textContent).toContain("No countries match");
  });

  test("same save may occupy both slots and no-difference state keeps its header", async () => {
    await render();
    await select("compare-base", entries[0].hash);
    await select("compare-target", entries[0].hash);
    await click("Compare");
    const data = response(entries[0].hash, entries[0].hash);
    data.hasChanges = false;
    data.countries = [];
    for (const key of Object.keys(
      data.summary,
    ) as (keyof typeof data.summary)[])
      data.summary[key] = diff(0, 0);
    await finish(data);
    expect(results().textContent).toContain(
      "No differences in compared metrics.",
    );
    expect(
      results().querySelectorAll(".comparison-direction strong"),
    ).toHaveLength(2);
    expect(results().textContent).toContain("Base.hoi4");
    expect(results().textContent).not.toContain("+0");
  });

  test("failed request preserves completed comparison and does not render server details", async () => {
    await render();
    await choose();
    await click("Compare");
    await finish();
    await click("Swap");
    await click("Compare");
    await act(async () =>
      comparisons()[1].resolve(
        new Response("C:/private/stack", { status: 503 }),
      ),
    );
    expect(container.textContent).toContain("Could not compare saved analyses");
    expect(container.textContent).toContain("last completed comparison");
    expect(
      results().querySelector(".comparison-direction strong")?.textContent,
    ).toBe("Base.hoi4");
    expect(container.textContent).not.toContain("private");
  });

  test("unavailable comparison refreshes history and invalidates selection", async () => {
    await render();
    await choose();
    await click("Compare");
    await act(async () =>
      comparisons()[0].resolve(new Response("missing", { status: 404 })),
    );
    const reads = requests.filter((r) => r.url === "/api/analyze/recent");
    expect(reads).toHaveLength(2);
    await act(async () =>
      reads[1].resolve(
        Response.json({
          items: entries.map((i) => ({ ...i, hasPersistedResult: false })),
        }),
      ),
    );
    expect(
      (container.querySelector("#compare-base") as HTMLSelectElement).value,
    ).toBe("");
    expect(button("Compare").disabled).toBe(true);
    expect(container.textContent).toContain("no longer available");
  });

  test("deleting a selected analysis cancels pending comparison and keeps other selection", async () => {
    await render();
    await choose();
    await click("Compare");
    const request = comparisons()[0];
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Delete analysis Base.hoi4"]',
        )!
        .click(),
    );
    const remove = requests.find((r) => r.init?.method === "DELETE")!;
    await act(async () =>
      remove.resolve(Response.json({ items: entries.slice(1) })),
    );
    expect(request.init?.signal?.aborted).toBe(true);
    await act(async () => request.resolve(Response.json(response())));
    expect(results()).toBeNull();
    expect(
      (container.querySelector("#compare-target") as HTMLSelectElement).value,
    ).toBe(entries[1].hash);
  });

  test("comparison coexists with Open and a subsequent upload without clearing normal analysis", async () => {
    await render(true);
    const snapshot = {
      game_date: "1944.5.1",
      parse_seconds: 0.1,
      file_size_mb: 1,
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
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open analysis Base.hoi4"]',
        )!
        .click(),
    );
    await act(async () =>
      requests
        .find((r) => r.url.endsWith("/result"))!
        .resolve(Response.json(snapshot)),
    );
    await choose();
    await click("Compare");
    await finish();
    expect(
      container.querySelector(".analyzer-view-date strong")?.textContent,
    ).toBe("1944.5.1");
    await act(async () => {
      const picker =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(picker, "files", {
        value: [new File(["fixture"], "new.hoi4")],
      });
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () =>
      requests
        .find((r) => r.url === "/api/analyze")!
        .resolve(Response.json({ ...snapshot, game_date: "1945.1.1" })),
    );
    expect(
      container.querySelector(".analyzer-view-date strong")?.textContent,
    ).toBe("1945.1.1");
    expect(results()).not.toBeNull();
    expect(results().textContent).toContain("Base.hoi4");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Open analysis Target.hoi4"]',
        )!
        .click(),
    );
    await act(async () =>
      requests
        .filter((r) => r.url.endsWith("/result"))
        .at(-1)!
        .resolve(Response.json({ ...snapshot, game_date: "1944.6.1" })),
    );
    expect(
      container.querySelector(".analyzer-view-date strong")?.textContent,
    ).toBe("1944.6.1");
    expect(
      results().querySelector(".comparison-direction strong")?.textContent,
    ).toBe("Base.hoi4");
  });

  test("responsive table and labelled native controls remain keyboard accessible", async () => {
    await render();
    await choose();
    await click("Compare");
    await finish();
    expect(container.querySelector('label[for="compare-base"]')).not.toBeNull();
    expect(
      container.querySelector('label[for="compare-target"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[aria-label="Country comparison table"]')
        ?.getAttribute("tabindex"),
    ).toBe("0");
    expect(
      container.querySelector(
        '[aria-label="Compare saves"] [aria-live="polite"]',
      ),
    ).not.toBeNull();
  });
});
