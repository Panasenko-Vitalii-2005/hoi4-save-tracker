import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { CampaignIntelligence } from "@/components/chart/CampaignIntelligence";
import { CampaignTrends } from "@/components/chart/CampaignTrends";
import {
  campaignFixture,
  intelligenceFixture,
  trendsFixture,
  hash,
} from "./fixtures/campaign-intelligence.fixture";
import { reviewEndpoints, trackCampaignReview } from "@/lib/product-telemetry";
import { seedCsrfCookie } from "./auth-fixture";
vi.mock("react-plotly.js", () => ({
  default: function MockPlot({
    onInitialized,
  }: {
    onInitialized?: () => void;
  }) {
    useEffect(() => {
      onInitialized?.();
    }, [onInitialized]);
    return <div data-testid="plot" />;
  },
}));
let root: Root, container: HTMLDivElement;
let insight = intelligenceFixture(),
  trends = trendsFixture();
let fail = false;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  seedCsrfCookie();
  sessionStorage.setItem(
    "hoi4:product-telemetry:session:v1",
    "22222222-2222-4222-8222-222222222222",
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  insight = intelligenceFixture();
  trends = trendsFixture();
  fail = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("product-events"))
        return new Response(null, { status: 202 });
      if (fail)
        return Response.json({ message: "unavailable" }, { status: 503 });
      return Response.json(url.includes("intelligence?") ? insight : trends);
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
const events = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([input]) => String(input).includes("product-events"))
    .map(([, init]) => JSON.parse(String(init?.body)));
const intelligence = () => (
  <CampaignIntelligence campaign={campaignFixture()} countryTag="GER" />
);
test("real displayed Intelligence insights count once through rerenders/remounts", async () => {
  await act(async () => root.render(intelligence()));
  expect(
    container.querySelectorAll(".intelligence-card").length,
  ).toBeGreaterThan(0);
  expect(events()).toEqual([
    {
      eventName: "campaign_review_opened",
      baseHash: hash("a"),
      targetHash: hash("c"),
      clientSessionId: "22222222-2222-4222-8222-222222222222",
      viewKind: "intelligence",
    },
  ]);
  await act(async () => root.render(intelligence()));
  await act(async () => root.render(null));
  await act(async () => root.render(intelligence()));
  expect(events()).toHaveLength(1);
});
test.each(["empty", "error", "suppressed", "unsupported"])(
  "Intelligence %s is not a successful insight review",
  async (state) => {
    if (state === "empty") insight.insights = [];
    if (state === "error") fail = true;
    if (state === "suppressed") insight.window.temporalEligible = false;
    if (state === "unsupported")
      insight.insights = insight.insights.map((i) => ({
        ...i,
        catalogVersion: 999,
      }));
    await act(async () => root.render(intelligence()));
    expect(events()).toHaveLength(0);
  },
);
test("loading Intelligence does not count", async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(intelligence()));
  expect(events()).toHaveLength(0);
});
test("Trends counts only an initialized chart with usable historical points", async () => {
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
  expect(events().some((e) => e.viewKind === "trends")).toBe(true);
});
test("one-snapshot/invalid/conflicting-version endpoints are not historical review", async () => {
  const snapshots = campaignFixture().snapshots;
  expect(reviewEndpoints([snapshots[0]])).toBeNull();
  expect(
    reviewEndpoints([
      snapshots[0],
      { ...snapshots[1], gameDate: snapshots[0].gameDate },
    ]),
  ).toBeNull();
  expect(
    reviewEndpoints([snapshots[0], { ...snapshots[1], gameVersion: "1.19.3" }]),
  ).toBeNull();
  await trackCampaignReview("compare", hash("a"), hash("a"));
  expect(events()).toHaveLength(0);
});
test("bounded review payload preserves credentials/CSRF and excludes names/paths/metrics", async () => {
  await trackCampaignReview("compare", hash("a"), hash("c"));
  await trackCampaignReview("compare", hash("a"), hash("c"));
  expect(events()).toHaveLength(1);
  const [, init] = vi.mocked(fetch).mock.calls[0];
  expect(init?.credentials).toBe("include");
  expect(new Headers(init?.headers).has("X-CSRF-Token")).toBe(true);
  expect(Object.keys(events()[0]).sort()).toEqual([
    "baseHash",
    "clientSessionId",
    "eventName",
    "targetHash",
    "viewKind",
  ]);
});
