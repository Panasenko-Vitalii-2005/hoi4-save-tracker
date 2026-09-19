import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  sharedAnalysisTelemetryHeaders,
  trackAnalysisEvent,
} from "../src/lib/product-telemetry";
import { seedCsrfCookie } from "./auth-fixture";

const HASH = "a".repeat(64);
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_KEY = "hoi4:product-telemetry:session:v1";

describe("product telemetry client", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem(SESSION_KEY, SESSION_ID);
    seedCsrfCookie();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 202 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  test("emits one opened event per analysis and browser session", async () => {
    await trackAnalysisEvent("analysis_opened", HASH);
    await trackAnalysisEvent("analysis_opened", HASH);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/product-events/client",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
    const body = JSON.parse(
      String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body),
    );
    expect(body).toEqual({
      eventName: "analysis_opened",
      analysisHash: HASH,
      clientSessionId: SESSION_ID,
    });
  });

  test("deduplicates each valid section without collapsing different sections", async () => {
    await trackAnalysisEvent("analysis_section_viewed", HASH, "overview");
    await trackAnalysisEvent("analysis_section_viewed", HASH, "overview");
    await trackAnalysisEvent("analysis_section_viewed", HASH, "production");
    await trackAnalysisEvent(
      "analysis_section_viewed",
      HASH,
      "not-a-section" as never,
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.map(([, init]) => JSON.parse(String(init?.body)).section),
    ).toEqual(["overview", "production"]);
  });

  test("telemetry transport failure never rejects the user workflow", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await expect(
      trackAnalysisEvent("analysis_shared", HASH),
    ).resolves.toBeUndefined();
  });

  test("adds only the random browser-session correlation header to public opens", () => {
    expect(sharedAnalysisTelemetryHeaders()).toEqual({
      "X-Product-Session": SESSION_ID,
    });
  });
});
