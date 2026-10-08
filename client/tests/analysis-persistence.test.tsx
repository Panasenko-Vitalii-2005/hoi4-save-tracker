import { describe, expect, test } from "vitest";
import { readAnalysisPersistence } from "../src/lib/analysis-persistence";

describe("explicit analysis persistence response", () => {
  test("only saved plus a valid hash grants a saved result identity", () => {
    expect(
      readAnalysisPersistence(
        new Headers({
          "X-Analysis-Persistence": "saved",
          "X-Analysis-Hash": "A".repeat(64),
        }),
      ),
    ).toEqual({ outcome: "saved", savedHash: "a".repeat(64) });
  });
  test.each([undefined, "saved", "invalid"])(
    "%s without a valid hash stays unconfirmed",
    (outcome) => {
      const headers = new Headers({ "X-Analysis-Hash": "not-a-hash" });
      if (outcome) headers.set("X-Analysis-Persistence", outcome);
      expect(readAnalysisPersistence(headers)).toEqual({
        outcome: "unknown",
        savedHash: null,
      });
    },
  );
  test("a temporary response never uses a hash even if a server mistakenly sends one", () => {
    expect(
      readAnalysisPersistence(
        new Headers({
          "X-Analysis-Persistence": "temporary",
          "X-Analysis-Hash": "b".repeat(64),
        }),
      ),
    ).toEqual({ outcome: "temporary", savedHash: null });
  });
  test("legacy hash-only success is not durable evidence", () => {
    expect(
      readAnalysisPersistence(
        new Headers({ "X-Analysis-Hash": "b".repeat(64) }),
      ),
    ).toEqual({ outcome: "unknown", savedHash: null });
  });
});
