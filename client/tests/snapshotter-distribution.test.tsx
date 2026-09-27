import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  SNAPSHOTTER_DOWNLOAD_PATH,
  SNAPSHOTTER_GUI_DOWNLOAD_URL,
} from "../src/components/analyzer/BatchAnalysisPanel";

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

  test("uses the verified repository's stable latest-release GUI asset URL", () => {
    expect(SNAPSHOTTER_GUI_DOWNLOAD_URL).toBe(
      "https://github.com/Panasenko-Vitalii-2005/hoi4-save-tracker/releases/latest/download/Snapshotter.Gui.exe",
    );
  });

  test("release workflow is tag-only and uploads the same named self-contained asset", async () => {
    const workflow = await readFile(
      resolve(process.cwd(), "../.github/workflows/snapshotter-release.yml"),
      "utf8",
    );
    expect(workflow).toMatch(/on:\s*\n  push:\s*\n    tags:\s*\n      - 'snapshotter-v\*'/);
    expect(workflow).toContain("actions/checkout@v6");
    expect(workflow).toContain("ref: ${{ github.ref }}");
    expect(workflow).toContain("dotnet-version: '9.0.316'");
    expect(workflow).toContain("Snapshotter.Tests/Snapshotter.Tests.csproj");
    expect(workflow).toContain("--runtime win-x64 --self-contained true");
    expect(workflow).toContain("-p:PublishSingleFile=true");
    expect(workflow).toContain("Snapshotter.Gui.exe.sha256");
    expect(workflow).toContain("make_latest: true");
    expect(workflow).toContain("contents: write");
    expect(workflow).not.toMatch(/branches:\s*\n\s*- main/);
  });
});
