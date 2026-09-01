import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RecentAnalyses } from "../src/components/analyzer/RecentAnalyses";
import { AnalyzerTab } from "../src/components/analyzer/AnalyzerTab";
import { AnalysisComparison } from "../src/components/analyzer/AnalysisComparison";
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
  gameDate = "1944.5.1",
): RecentAnalysis => ({
  hash: letter.repeat(64),
  fileName,
  hasPersistedResult: available,
  pinned: false,
  fileSizeBytes: 100,
  analyzedAt: "2026-08-28T10:00:00Z",
  gameDate,
  countryCount: 1,
  divisionCount: 10,
  shipCount: 2,
  navalLossCount: 1,
});
const entries = [
  entry("a", "Base.hoi4", true, "1944.5.1"),
  entry("b", "Target.hoi4", true, "1944.6.1"),
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
  context: {
    chronology: "target_after_base",
    sameAnalysis: base === target,
    campaignCompatibility: "unknown",
    gameVersionCompatibility: "unknown",
  },
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
  const buttonByLabel = (label: string) =>
    container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
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
  const comparisonRows = () => [
    ...results().querySelectorAll(".comparison-country-table tbody tr"),
  ];
  const countryRow = (tag: string) =>
    comparisonRows().find(
      (item) => item.querySelector(".comparison-country-tag")?.textContent === tag,
    )!;

  test("explains Compare requirements with zero persisted analyses", async () => {
    const analyze = vi.fn();
    await act(async () =>
      root.render(
        <AnalysisComparison
          items={[]}
          busy={false}
          onUnavailable={() => {}}
          onAnalyzeSave={analyze}
        />,
      ),
    );
    const controls = container.querySelector('[aria-label="Compare saves"]')!;
    expect(controls.textContent).toContain(
      "Analyze at least two saves before comparing campaign snapshots",
    );
    expect(controls.querySelector("select")).toBeNull();
    await act(async () => button("Analyze Save").click());
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  test("explains that one persisted analysis needs one more save", async () => {
    await act(async () =>
      root.render(
        <AnalysisComparison
          items={[entries[0]]}
          busy={false}
          onUnavailable={() => {}}
        />,
      ),
    );
    const controls = container.querySelector('[aria-label="Compare saves"]')!;
    expect(controls.textContent).toContain("One saved analysis is ready");
    expect(controls.querySelector("select")).toBeNull();
  });

  test("two explicit slots offer only available analyses and require both selections", async () => {
    await render();
    const controls = container.querySelector('[aria-label="Compare saves"]')!;
    expect(controls.querySelector("h2")?.textContent).toBe("Compare Saves");
    expect(controls.querySelectorAll("select")).toHaveLength(2);
    expect(controls.textContent).not.toContain("Unavailable.hoi4");
    expect(container.querySelector('label[for="compare-base"]')?.textContent).toContain(
      "Base",
    );
    expect(
      container.querySelector('label[for="compare-target"]')?.textContent,
    ).toContain("Target");
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
    await act(async () =>
      buttonByLabel("Swap base and target analyses").click(),
    );
    expect(container.textContent).toContain(
      "Target save is earlier than Base save. Changes are still calculated as Target − Base.",
    );
    await click("Compare");
    const query = new URL(comparisons()[0].url, "http://localhost")
      .searchParams;
    expect(query.get("base")).toBe(entries[1].hash);
    expect(query.get("target")).toBe(entries[0].hash);
    const swapped = response(entries[1].hash, entries[0].hash);
    swapped.context.chronology = "target_before_base";
    await finish(swapped);
    const names = [
      ...results().querySelectorAll(".comparison-direction strong"),
    ].map((n) => n.textContent);
    expect(names).toEqual(["Target.hoi4", "Base.hoi4"]);
    expect(results().textContent).toContain("Target save is earlier than Base");

    await act(async () =>
      buttonByLabel("Swap base and target analyses").click(),
    );
    expect(container.textContent).not.toContain("Target save is earlier");
    await click("Compare");
    await finish(response());
    expect(results().textContent).not.toContain("Target save is earlier");
  });

  test("renders reverse, normal, same-date and same-analysis chronology context", async () => {
    await render();
    await choose();
    await click("Compare");
    const reverse = response();
    reverse.context.chronology = "target_before_base";
    await finish(reverse);
    expect(results().textContent).toContain(
      "Target save is earlier than Base save. Changes are still calculated as Target − Base.",
    );

    await click("Compare");
    await finish(response());
    expect(results().textContent).not.toContain("Target save is earlier");

    await click("Compare");
    const sameDate = response();
    sameDate.context.chronology = "same_date";
    sameDate.targetGameDate = sameDate.baseGameDate;
    await finish(sameDate);
    expect(results().textContent).toContain(
      "Base and Target have the same game date.",
    );

    await select("compare-target", entries[0].hash);
    await click("Compare");
    const same = response(entries[0].hash, entries[0].hash);
    same.context.sameAnalysis = true;
    same.context.chronology = "same_date";
    await finish(same);
    expect(results().textContent).toContain(
      "Base and Target are the same saved analysis.",
    );
    expect(results().textContent).not.toContain(
      "Base and Target have the same game date.",
    );
  });

  test("renders same, different and unknown campaign evidence without blocking", async () => {
    await render();
    await choose();
    await click("Compare");
    const same = response();
    same.context.campaignCompatibility = "same";
    await finish(same);
    expect(results().textContent).toContain("Same campaign");

    await click("Compare");
    const different = response();
    different.context.campaignCompatibility = "different";
    different.context.gameVersionCompatibility = "different";
    await finish(different);
    expect(results().textContent).toContain(
      "These saves appear to belong to different campaigns.",
    );
    expect(results().textContent).toContain("different game versions");

    await click("Compare");
    await finish(response());
    expect(results().textContent).toContain("Campaign relationship unknown");
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
    await act(async () =>
      buttonByLabel("Swap base and target analyses").click(),
    );
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
    const cells = countryRow("GER").querySelectorAll("td");
    expect(cells[2].textContent).toBe("+2");
    expect(cells[3].textContent).toBe("-2");
    expect(cells[4].textContent).toBe("—");
    expect(cells[7].textContent).toBe("N/A");
    expect(cells[4].querySelector('[aria-label="No change"]')).not.toBeNull();
    expect(cells[7].querySelector('[aria-label="Unavailable"]')).not.toBeNull();
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
      button("Changed only").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(comparisonRows()).toHaveLength(3);
    expect(results().textContent).toContain("Target only");
    expect(results().textContent).toContain("Base only");
    expect(results().textContent).toContain("Germany");
    expect(results().textContent).toContain("United Kingdom");
    await click("All countries");
    expect(comparisonRows()).toHaveLength(5);
    expect(
      comparisonRows().filter((r) => r.textContent?.includes("Denmark")),
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
    expect(comparisonRows()).toHaveLength(1);
    await search("d04");
    expect(comparisonRows()[0].textContent).toContain("D04");
    await search("nonexistent");
    expect(results().textContent).toContain("No countries match");
  });

  test("six summary cards emphasize delta while retaining exact Base and Target values", async () => {
    await render();
    await choose();
    await click("Compare");
    await finish();
    const cards = results().querySelectorAll(".comparison-metric-card");
    expect(cards).toHaveLength(6);
    expect(cards[0].textContent).toContain("Active countries");
    expect(cards[0].textContent).toContain("2 → 3");
    expect(cards[0].textContent).toContain("+1");
    expect(cards[3].querySelector("svg, canvas")).toBeNull();
  });

  test("large table deltas are compact while Country Detail retains exact values", async () => {
    await render();
    await choose();
    await click("Compare");
    const data = response();
    data.summary.manpowerInField = diff(1_000_000, 1_182_000);
    const germany = data.countries.find((country) => country.tag === "GER")!;
    germany.manpowerInField = diff(1_000_000, 2_276_500);
    await finish(data);
    expect(
      [...results().querySelectorAll(".comparison-metric-card")].find((card) =>
        card.textContent?.includes("Manpower in field"),
      )?.textContent,
    ).toContain("+182k");
    expect(countryRow("GER").textContent).toContain("+1.28M");
    await act(async () => countryRow("GER").click());
    const detail = results().querySelector('[aria-label="Country detail"]')!;
    expect(detail.textContent).toMatch(/1\D000\D000/);
    expect(detail.textContent).toMatch(/2\D276\D500/);
    expect(detail.textContent).toMatch(/\+1\D276\D500/);
  });

  test("mouse and keyboard row activation update accessible Country Detail selection", async () => {
    await render();
    await choose();
    await click("Compare");
    await finish();
    const england = countryRow("ENG") as HTMLTableRowElement;
    await act(async () => england.click());
    expect(england.getAttribute("aria-selected")).toBe("true");
    expect(results().querySelector('[aria-label="Country detail"]')?.textContent).toContain(
      "United Kingdom",
    );
    expect(results().textContent).toContain("Present only in Base");

    const added = countryRow("D04") as HTMLTableRowElement;
    added.focus();
    await act(async () =>
      added.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      ),
    );
    expect(added.getAttribute("aria-selected")).toBe("true");
    expect(results().querySelector('[aria-label="Country detail"]')?.textContent).toContain(
      "Present only in Target",
    );
  });

  test("metric sorting uses absolute delta, puts unavailable last and breaks ties deterministically", async () => {
    await render();
    await choose();
    await click("Compare");
    const data = response();
    const germany = row("GER", true);
    germany.effectiveMilitaryFactories = diff(10, 110);
    germany.effectiveCivilianFactories = diff(0, 10);
    const england = row("ENG", true);
    england.effectiveMilitaryFactories = diff(100, 10);
    england.effectiveCivilianFactories = diff(0, 10);
    const italy = row("ITA", true);
    italy.effectiveMilitaryFactories = diff(10, 30);
    italy.effectiveCivilianFactories = diff(0, 10);
    const unavailable = row("D04", true, "added");
    unavailable.effectiveMilitaryFactories = diff(null, 20);
    data.countries = [italy, unavailable, england, germany];
    await finish(data);
    await select("comparison-country-sort", "effectiveMilitaryFactories");
    expect(
      comparisonRows().map(
        (item) => item.querySelector(".comparison-country-tag")?.textContent,
      ),
    ).toEqual(["GER", "ENG", "ITA", "D04"]);
    await act(async () =>
      buttonByLabel(
        "Current order largest first; sort smallest absolute changes first",
      ).click(),
    );
    expect(
      comparisonRows().map(
        (item) => item.querySelector(".comparison-country-tag")?.textContent,
      ),
    ).toEqual(["ITA", "ENG", "GER", "D04"]);
    await act(async () =>
      buttonByLabel(
        "Current order smallest first; sort largest absolute changes first",
      ).click(),
    );

    await select("comparison-country-sort", "effectiveCivilianFactories");
    expect(
      comparisonRows().slice(0, 3).map(
        (item) => item.querySelector(".comparison-country-tag")?.textContent,
      ),
    ).toEqual(["GER", "ITA", "ENG"]);
  });

  test("a 100-country result renders and responds to search and sort without virtualization", async () => {
    await render();
    await choose();
    await click("Compare");
    const data = response();
    data.countries = Array.from({ length: 100 }, (_, index) => {
      const country = row(`X${index.toString().padStart(2, "0")}`, true);
      country.effectiveMilitaryFactories = diff(0, index);
      country.manpowerInField = diff(0, index * 1_000);
      return country;
    });
    const renderStart = performance.now();
    await finish(data);
    const renderMs = performance.now() - renderStart;
    expect(comparisonRows()).toHaveLength(100);

    const search = container.querySelector<HTMLInputElement>(
      "#comparison-country-search",
    )!;
    const searchStart = performance.now();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "X42");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const searchMs = performance.now() - searchStart;
    expect(comparisonRows()).toHaveLength(1);

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sortStart = performance.now();
    await select("comparison-country-sort", "manpowerInField");
    const sortMs = performance.now() - sortStart;
    expect(
      comparisonRows()[0].querySelector(".comparison-country-tag")?.textContent,
    ).toBe("X99");
    expect(Math.max(renderMs, searchMs, sortMs)).toBeLessThan(2_000);
  });

  test("About Changes defines snapshot semantics without fabricated history", async () => {
    await render();
    await choose();
    await click("Compare");
    await finish();
    const about = results().querySelector('[aria-label="About changes"]')!;
    expect(about.textContent).toContain("Target − Base snapshot differences");
    expect(about.textContent).toContain("PositiveTarget higher");
    expect(about.textContent).toContain("NegativeTarget lower");
    expect(about.textContent).toMatch(/recorded naval losses/i);
    expect(about.textContent).toContain(
      "do not prove those losses occurred strictly between the selected saves",
    );
    expect(about.textContent).toContain(
      "do not prove casualties occurred during the selected interval",
    );
    expect(results().textContent).not.toMatch(/sparkline|historical trend|timeline/i);
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
    await act(async () =>
      buttonByLabel("Swap base and target analyses").click(),
    );
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
    expect(container.querySelector("#compare-base")).toBeNull();
    expect(container.querySelector("#compare-target")).toBeNull();
    expect(container.textContent).toContain(
      "Analyze at least two saves before comparing campaign snapshots",
    );
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
    const sortDirection = results().querySelector(
      ".comparison-sort-direction",
    )!;
    expect(sortDirection.textContent).toBe("↓");
    expect(sortDirection.textContent).not.toContain("Largest first");
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
    expect(
      [...results().querySelectorAll(".comparison-detail-table thead th")].map(
        (cell) => cell.textContent,
      ),
    ).toEqual(["Metric", "Base", "Target", "Change"]);
  });
});
