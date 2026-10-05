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
} from "./fixtures/campaign-intelligence.fixture";

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
});
