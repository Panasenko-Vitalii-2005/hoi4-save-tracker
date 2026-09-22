import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { SNAPSHOTTER_DOWNLOAD_PATH } from "../src/components/analyzer/BatchAnalysisPanel";

describe("snapshotter distribution", () => {
  test("staged download is byte-identical to the canonical reviewed script", async () => {
    const canonical = await readFile(
      resolve(
        process.cwd(),
        "../tools/hoi4-save-snapshotter/snapshotter.ps1",
      ),
    );
    const downloadable = await readFile(
      resolve(process.cwd(), "public/downloads/hoi4-save-snapshotter.ps1"),
    );

    expect(downloadable.equals(canonical)).toBe(true);
    expect(SNAPSHOTTER_DOWNLOAD_PATH).toBe(
      "/downloads/hoi4-save-snapshotter.ps1",
    );
  });
});
