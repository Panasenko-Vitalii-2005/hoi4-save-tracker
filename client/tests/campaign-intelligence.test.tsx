import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CampaignTrends } from "../src/components/chart/CampaignTrends";
import { CampaignIntelligence } from "../src/components/chart/CampaignIntelligence";
import {
  defaultIntelligenceWindow,
  intelligenceDay,
  isCampaignIntelligenceDto,
} from "../src/lib/campaign-intelligence";
import { rawEconomyValue } from "../src/lib/economy-display";
import { formatEquipmentDefinition } from "../src/lib/utils";
import { i18n } from "../src/i18n";
import { enIntelligence, ruIntelligence } from "../src/i18n/intelligence";
import {
  INSIGHT_FAMILIES,
  type CampaignIntelligenceDto,
} from "../src/types/campaign-intelligence";
import type { CampaignIntelligenceDto as BackendContract } from "../../server/src/analyze/intelligence/intelligence.types";
import {
  campaignFixture,
  intelligenceFixture,
  trendsFixture,
  hash,
  acceptanceFixture,
} from "./fixtures/campaign-intelligence.fixture";
import {
  groupCoverage,
  generalLimits,
} from "../src/lib/intelligence-presentation";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const exactContract: Equal<CampaignIntelligenceDto, BackendContract> = true;
vi.mock("react-plotly.js", () => ({
  default: () => <div data-testid="plot" />,
}));

describe("Campaign Intelligence frontend", () => {
  let container: HTMLDivElement, root: Root;
  let data: CampaignIntelligenceDto,
    campaign: ReturnType<typeof campaignFixture>;
  let status: number, failed: boolean;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    data = intelligenceFixture();
    campaign = campaignFixture();
    status = 200;
    failed = false;
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/intelligence?")) {
        if (failed) throw new Error("private path should not leak");
        const query = new URL(String(input), "http://localhost").searchParams;
        return Response.json(
          {
            ...data,
            window: {
              ...data.window,
              campaignKey: query.get("campaignKey"),
              countryTag: query.get("countryTag"),
              baseHash: query.get("baseHash"),
              targetHash: query.get("targetHash"),
            },
          },
          { status },
        );
      }
      return Response.json(trendsFixture());
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  const render = async (countryTag = "GER") =>
    act(async () =>
      root.render(
        <CampaignIntelligence campaign={campaign} countryTag={countryTag} />,
      ),
    );
  const text = () => container.textContent ?? "";
  const requests = () =>
    fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/intelligence?"),
    );
  const change = async (select: HTMLSelectElement, value: string) =>
    act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  const click = async (button: HTMLElement) => act(async () => button.click());

  test("public contract matches accepted backend exactly", () => {
    expect(exactContract).toBe(true);
    expect(isCampaignIntelligenceDto(data)).toBe(true);
  });
  test("inside Campaign Trends with no new top-level navigation", async () => {
    await act(async () =>
      root.render(
        <CampaignTrends
          telemetry={[]}
          telemetryLoading={false}
          telemetryError={null}
          reloadTelemetry={() => {}}
        />,
      ),
    );
    expect(
      container.querySelector(".campaign-trends .campaign-intelligence"),
    ).not.toBeNull();
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector('[data-testid="plot"]')).not.toBeNull();
  });
  test("default window uses real hashes and session-aware API", async () => {
    await render();
    const [url, init] = requests()[0];
    const query = new URL(String(url), "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      campaignKey: campaign.key,
      countryTag: "GER",
      baseHash: hash("a"),
      targetHash: hash("c"),
    });
    expect(init.credentials).toBe("include");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  test("manual endpoints are not automatically swapped", async () => {
    await render();
    const selects = container.querySelectorAll("select");
    await change(selects[0], hash("c"));
    await change(selects[1], hash("a"));
    const query = new URL(String(requests().at(-1)![0]), "http://localhost")
      .searchParams;
    expect(query.get("baseHash")).toBe(hash("c"));
    expect(query.get("targetHash")).toBe(hash("a"));
  });
  test("country change updates request", async () => {
    await render();
    await render("USA");
    expect(String(requests().at(-1)![0])).toContain("countryTag=USA");
  });
  test("shared Trends country selector drives Intelligence even in global chart mode", async () => {
    await act(async () =>
      root.render(
        <CampaignTrends
          telemetry={[]}
          telemetryLoading={false}
          telemetryError={null}
          reloadTelemetry={() => {}}
        />,
      ),
    );
    const selector = container.querySelector<HTMLSelectElement>(
      ".campaign-country-field select",
    )!;
    await change(selector, "USA");
    expect(String(requests().at(-1)![0])).toContain("countryTag=USA");
    expect(
      container.querySelector(".campaign-intelligence")?.textContent,
    ).toContain("United States");
  });
  test.each(["country", "campaign", "snapshot"])(
    "missing %s prerequisite issues no request",
    async (missing) => {
      if (missing === "campaign") campaign.relationship = "unknown";
      if (missing === "snapshot")
        campaign.snapshots = campaign.snapshots.slice(0, 1);
      await render(missing === "country" ? "" : "GER");
      expect(requests()).toHaveLength(0);
    },
  );
  test("loading state is visible", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await render();
    expect(text()).toContain("Loading Campaign Intelligence");
  });
  test.each([400, 404, 503])(
    "HTTP %s is a clear failure, not an empty pattern",
    async (code) => {
      status = code;
      await render();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(text()).not.toContain(enIntelligence.empty);
    },
  );
  test("network error is generic and retry works", async () => {
    failed = true;
    await render();
    expect(text()).not.toContain("private path");
    failed = false;
    await click(container.querySelector("button")!);
    expect(container.querySelectorAll(".intelligence-card")).toHaveLength(6);
  });
  test("late response from superseded window cannot replace current country", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    await render();
    await render("USA");
    await act(async () => resolve(Response.json(data)));
    expect(text()).toContain("United States");
    expect(text()).not.toContain("could not be loaded");
  });
  test("valid empty is neutral, not nothing changed", async () => {
    data.insights = [];
    await render();
    expect(text()).toContain(enIntelligence.empty);
    expect(text()).not.toMatch(/nothing changed/i);
  });
  test("legacy missing data is distinct from no match", async () => {
    data.insights = [];
    data.summaries[0].startValue = null;
    data.coverageIssues.push({
      code: "metric_legacy",
      metric: data.summaries[0].metric,
    });
    await render();
    expect(text()).toContain(enIntelligence.incomplete);
    expect(text()).toContain(enIntelligence.quality.metric_legacy);
  });
  test.each([
    "same_date_chronology_unknown",
    "reversed_temporal_window",
    "game_version_mismatch",
    "invalid_game_date",
  ])("suppression %s remains explicit", async (reason) => {
    data.window.temporalEligible = false;
    data.window.suppressionReasons = [reason];
    await render();
    expect(text()).toContain(enIntelligence.ineligible);
    expect(container.querySelector(".intelligence-card")).toBeNull();
    expect(text()).not.toContain(enIntelligence.empty);
  });
  test.each(["en", "ru"])(
    "all six families and both severities localize in %s",
    async (language) => {
      await i18n.changeLanguage(language);
      await render();
      const resource = language === "ru" ? ruIntelligence : enIntelligence;
      expect(container.querySelectorAll(".intelligence-card")).toHaveLength(6);
      for (const id of INSIGHT_FAMILIES)
        expect(text()).toContain(resource.titles[id]);
      expect(text()).toContain(resource.severity.informational);
      expect(text()).toContain(resource.severity.attention);
      expect(text()).toContain(resource.disclaimer);
      expect(text()).not.toMatch(
        /intelligence\.(titles|quality|operations)|caused|critical|severe|collapse/i,
      );
    },
  );
  test.each(["catalog", "message", "causal"])(
    "unknown/unsafe %s fails closed",
    async (variant) => {
      const wire = JSON.parse(JSON.stringify(data));
      if (variant === "catalog")
        wire.insights[0].catalogId = "NEW_UNSUPPORTED_RULE";
      if (variant === "message")
        wire.insights[0].messageKey = "arbitrary.prose";
      if (variant === "causal") wire.insights[0].causalClaim = true;
      data = wire;
      await render();
      expect(text()).toContain(enIntelligence.unsupportedTitle);
      expect(text()).not.toContain("arbitrary.prose");
    },
  );
  test("signed balances and fractional values keep raw precision without fake percentages", async () => {
    await render();
    expect(text()).toContain("43 → -71");
    expect(text()).toContain("Change: -114");
    expect(text()).toContain("9.57792");
    expect(text()).not.toContain("%");
    expect(rawEconomyValue(5.57792)).toBe("5.57792");
    expect(rawEconomyValue(null)).toBe("—");
    expect(rawEconomyValue(0)).toBe("0");
  });
  test("evidence expansion is accessible and exposes exact values and source snapshots", async () => {
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-expanded="false"]',
    )!;
    expect(container.querySelector(".intelligence-evidence")).toBeNull();
    await click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(button.getAttribute("aria-controls")!),
    ).not.toBeNull();
    expect(container.querySelector(".intelligence-evidence-record")).toBeNull();
    await click(container.querySelector(".intelligence-evidence button")!);
    expect(text()).toContain(hash("a"));
    expect(text()).toContain(hash("c"));
    expect(text()).toContain("121 → 164 → 43");
    expect(text()).toContain("01.01.1941");
    await click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".intelligence-evidence")).toBeNull();
  });
  test("missing evidence and explicit zero stay different", async () => {
    data.evidence[0].rawValues = [null, 0, 5.57792];
    await render();
    await click(container.querySelector("button")!);
    await click(container.querySelector(".intelligence-evidence button")!);
    expect(text()).toContain("— → 0 → 5.57792");
  });
  test("crossing shows backend snapshot bracket, never invented intermediate crossing date", async () => {
    await render();
    const crossing = container.querySelector(".intelligence-crossing")!;
    expect(crossing.textContent).toContain("01.01.1941");
    expect(crossing.textContent).toContain("01.01.1942");
    expect(crossing.textContent).not.toContain("15.06.1941");
  });
  test("equipment definitions remain distinct even when display names coincide", async () => {
    const extra = structuredClone(data.insights[4]);
    extra.id = "second-definition";
    extra.signalIds = ["second-allocation"];
    const signal = structuredClone(
      data.signals.find((s) => s.id === "equipment-allocation")!,
    );
    signal.id = "second-allocation";
    signal.metric.equipmentDefinition = "modded_tank";
    data.signals.push(signal);
    data.insights.push(extra);
    await render();
    expect(text()).toContain("modded__tank");
    expect(text()).toContain("modded_tank");
  });
  test("backend card ordering is preserved", async () => {
    data.insights.reverse();
    await render();
    expect(
      [...container.querySelectorAll(".intelligence-card")].map((card) =>
        card.getAttribute("data-catalog-id"),
      ),
    ).toEqual(data.insights.map((x) => x.catalogId));
  });
  test("chart transformations do not change intelligence request or output", async () => {
    await act(async () =>
      root.render(
        <CampaignTrends
          telemetry={[]}
          telemetryLoading={false}
          telemetryError={null}
          reloadTelemetry={() => {}}
        />,
      ),
    );
    const before = container.querySelector(
      ".campaign-intelligence",
    )!.textContent;
    const count = requests().length;
    const normalize = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Normalize"))!
      .querySelector("input")!;
    await click(normalize);
    const moving = [...container.querySelectorAll("label")]
      .find((label) => label.textContent?.includes("Moving average"))!
      .querySelector("select")!;
    await change(moving, "3");
    expect(requests()).toHaveLength(count);
    expect(container.querySelector(".campaign-intelligence")!.textContent).toBe(
      before,
    );
  });
  test("malformed response is rejected safely", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(Response.json({ ...data, evidence: [null] })),
    );
    await render();
    expect(text()).toContain(enIntelligence.errors.failed);
  });
  test("deterministic defaults ignore analyzedAt and same-day identities stay visible", async () => {
    campaign.snapshots[1].gameDate = campaign.snapshots[0].gameDate;
    campaign.snapshots.reverse();
    await render();
    const options = [
      ...container.querySelectorAll("select:first-of-type option"),
    ]
      .map((o) => o.textContent)
      .join(" ");
    expect(options).toContain("aaaaaaaa");
    expect(options).toContain("bbbbbbbb");
    expect(defaultIntelligenceWindow(campaign)).toEqual({
      baseHash: hash("a"),
      targetHash: hash("c"),
    });
  });
  test("same-day or known-version conflict has no fabricated default", () => {
    campaign.snapshots.forEach((s) => {
      s.gameDate = "1941.1.1";
    });
    expect(defaultIntelligenceWindow(campaign).baseHash).toBe("");
    campaign = campaignFixture();
    campaign.snapshots[1].gameVersion = "1.19.3";
    expect(defaultIntelligenceWindow(campaign).baseHash).toBe("");
    expect(intelligenceDay("1941.2.29")).toBeNull();
    expect(intelligenceDay("1944.2.29")).not.toBeNull();
  });
  test("acceptance first expansion is concise, second retains nine proof records in backend order", async () => {
    ({ data, campaign } = acceptanceFixture());
    await render();
    const card = container.querySelector(".intelligence-card")!;
    expect(card.textContent).toContain("280 → 286");
    expect(card.textContent).toContain("Change: +6");
    expect(card.textContent).toContain("285 → 292");
    expect(card.textContent).toContain("Change: +7");
    await click(card.querySelector("button")!);
    expect(card.textContent).toContain(enIntelligence.bothIncreased);
    expect(card.textContent).toContain("01.04.1944");
    expect(card.textContent).toContain("01.05.1944");
    expect(card.querySelectorAll(".intelligence-evidence-record")).toHaveLength(
      0,
    );
    const button = card.querySelector<HTMLButtonElement>(
      ".intelligence-evidence button",
    )!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(button.getAttribute("aria-controls")!),
    ).not.toBeNull();
    expect(
      [
        ...card.querySelectorAll(
          ".intelligence-evidence-record > code:first-child",
        ),
      ].map((el) => el.textContent?.split(" · ")[0]),
    ).toEqual(data.evidence.map((entry) => entry.id));
    expect(card.textContent).toContain("280 → 286 → 6");
    expect(card.textContent).toContain(
      "recorded.industry.effectiveMilitaryFactories",
    );
    expect(card.textContent).toContain("allocation_is_not_realized_output");
    await click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(card.querySelectorAll(".intelligence-evidence-record")).toHaveLength(
      0,
    );
  });
  test.each([1, 2])(
    "legacy endpoint count %s groups exact observations without claiming global absence",
    async (endpoints) => {
      ({ data, campaign } = acceptanceFixture(endpoints));
      await render();
      const groups = groupCoverage(data.coverageIssues);
      expect(
        groups.find((group) => group.domain === "production")?.definitions.size,
      ).toBe(11);
      expect(
        groups.find((group) => group.domain === "stockpile")?.definitions.size,
      ).toBe(14);
      expect(
        groups.find((group) => group.domain === "economy")?.issues,
      ).toHaveLength(endpoints * 12);
      const coverage = container.querySelector(".intelligence-coverage")!;
      expect(coverage.textContent).toContain(enIntelligence.legacyEconomy);
      expect(coverage.textContent).toContain(
        `Affected metric observations: ${endpoints * 12}`,
      );
      expect(coverage.textContent).not.toContain("modded__tank");
      expect(coverage.textContent).not.toContain("Steel · 0");
      const button = coverage.querySelector("button")!;
      await click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
      expect(
        document.getElementById(button.getAttribute("aria-controls")!),
      ).not.toBeNull();
      expect(
        coverage.querySelectorAll(".intelligence-affected > ul > li"),
      ).toHaveLength(data.coverageIssues.length);
      expect(coverage.textContent).toContain("modded__tank");
      expect(coverage.textContent).toContain("modded_tank");
      expect(coverage.textContent).toContain("01.04.1944");
      await click(button);
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(coverage.querySelector(".intelligence-affected")).toBeNull();
    },
  );
  test("general limits deduplicate across proof records and stay separate from metric coverage", async () => {
    ({ data, campaign } = acceptanceFixture());
    await render();
    const general = container.querySelector(".intelligence-general")!;
    expect(general.querySelectorAll("li")).toHaveLength(
      generalLimits(data).length,
    );
    expect(
      general.textContent?.split(
        enIntelligence.quality.serialized_state_at_save_time,
      ),
    ).toHaveLength(2);
    expect(general.textContent).not.toContain(
      enIntelligence.quality.metric_absent,
    );
    expect(
      container.querySelectorAll(".intelligence-coverage-group"),
    ).toHaveLength(3);
    expect(
      groupCoverage(data.coverageIssues)[0].definitions.has("modded__tank"),
    ).toBe(true);
    expect(
      groupCoverage(data.coverageIssues)[0].definitions.has("modded_tank"),
    ).toBe(true);
  });
  test.each(["en", "ru"])(
    "all six compact evidence summaries and disclosures localize in %s",
    async (language) => {
      await i18n.changeLanguage(language);
      await render();
      const messages = language === "en" ? enIntelligence : ruIntelligence;
      for (const card of container.querySelectorAll(".intelligence-card")) {
        await click(card.querySelector("button")!);
        expect(
          card.querySelectorAll(".intelligence-summary > div"),
        ).toHaveLength(2);
        expect(card.textContent).toContain(messages.showTechnical);
        expect(
          card.querySelectorAll(".intelligence-evidence-record"),
        ).toHaveLength(0);
        expect(card.textContent).not.toMatch(
          /caused|fully utilized|losses exceeded|trade failed/i,
        );
      }
      expect(text()).toContain(messages.generalLimits);
      expect(text()).toContain(messages.showAffected);
    },
  );
  test("compact summary trusts backend null, zero and exact decimals without recomputing delta", async () => {
    const summary = data.signals[0].summary;
    summary.startValue = null;
    summary.endValue = 0;
    summary.delta = null;
    await render();
    await click(container.querySelector(".intelligence-card button")!);
    const compact = container.querySelector(".intelligence-summary")!;
    expect(compact.textContent).toContain(" · —");
    expect(compact.textContent).toContain(" · 0");
    expect(compact.textContent).toContain("Change: —");
    expect(text()).toContain("9.57792");
  });
  test("reopening human evidence leaves technical disclosure collapsed", async () => {
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      ".intelligence-card button",
    )!;
    await click(button);
    await click(container.querySelector(".intelligence-evidence button")!);
    await click(button);
    await click(button);
    expect(container.querySelector(".intelligence-technical")).toBeNull();
  });
  test("grouping preserves inputs and ignores display labels and property order", () => {
    ({ data } = acceptanceFixture());
    const before = JSON.stringify(data);
    const groups = groupCoverage(data.coverageIssues);
    expect(groups.map((group) => group.domain)).toEqual([
      "production",
      "stockpile",
      "economy",
    ]);
    expect(groups[2].identities.size).toBe(12);
    expect(formatEquipmentDefinition("modded__tank")).toBe(
      formatEquipmentDefinition("modded_tank"),
    );
    const duplicate = {
      code: "metric_legacy",
      metric: {
        resource: "steel" as const,
        countryTag: "GER",
        id: "economy.productionDemand" as const,
      },
      snapshotHash: hash("a"),
    };
    expect(
      groupCoverage([...data.coverageIssues, duplicate])[2].identities.size,
    ).toBe(12);
    expect(JSON.stringify(data)).toBe(before);
  });
  test.each(["en", "ru"])(
    "coverage counts and legacy explanation localize in %s",
    async (language) => {
      ({ data, campaign } = acceptanceFixture());
      await i18n.changeLanguage(language);
      await render();
      const messages = language === "en" ? enIntelligence : ruIntelligence;
      expect(text()).toContain(messages.legacyEconomy);
      expect(text()).toContain(
        messages.observationCount.replace("{{count}}", "24"),
      );
      expect(text()).toContain(
        messages.definitionCount.replace("{{count}}", "11"),
      );
      expect(text()).toContain(
        messages.definitionCount.replace("{{count}}", "14"),
      );
      expect(text()).toContain(messages.metricCoverage);
      expect(text()).not.toContain("intelligence.");
    },
  );
  test("technical detail preserves per-record repeated and unknown qualifiers", async () => {
    data.evidence[0].qualifiers = [
      "serialized_state_at_save_time",
      "serialized_state_at_save_time",
      "future_limit_code",
    ];
    await render();
    await click(container.querySelector(".intelligence-card button")!);
    await click(container.querySelector(".intelligence-evidence button")!);
    const record = container.querySelector(".intelligence-evidence-record")!;
    expect(
      record.textContent?.split("serialized_state_at_save_time"),
    ).toHaveLength(3);
    expect(record.textContent).toContain("future_limit_code");
    expect(record.textContent).toContain(enIntelligence.unknownQualifier);
  });
});
