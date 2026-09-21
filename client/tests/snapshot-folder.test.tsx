import { describe, expect, test } from "vitest";
import {
  filterSnapshotFolderFiles,
  parseSnapshotTimestamp,
  sampleSnapshotFiles,
  sortSnapshotFiles,
} from "../src/lib/snapshot-folder";

function snapshot(
  name: string,
  lastModified = 0,
  relativePath = `snapshots/${name}`,
): File {
  const file = new File([name], name, { lastModified });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });
  return file;
}

describe("snapshot folder helpers", () => {
  test("parses valid snapshotter names including underscore-rich sources", () => {
    expect(
      parseSnapshotTimestamp("autosave_temp_2026-09-21_15-17-32.hoi4"),
    ).toBe(Date.UTC(2026, 8, 21, 15, 17, 32));
    expect(
      parseSnapshotTimestamp("my_campaign_autosave_2026-09-21_15-17-32_2.hoi4"),
    ).toBe(Date.UTC(2026, 8, 21, 15, 17, 32));
    expect(parseSnapshotTimestamp("autosave_temp.hoi4")).toBeNull();
    expect(
      parseSnapshotTimestamp("autosave_temp_2026-02-31_15-17-32.hoi4"),
    ).toBeNull();
  });

  test("sorts timestamps chronologically and uses stable metadata fallback", () => {
    const ordered = sortSnapshotFiles([
      snapshot("autosave_temp_2026-09-21_15-51-56.hoi4", 1),
      snapshot("manual-b.hoi4", Date.UTC(2026, 8, 21, 15, 30)),
      snapshot("autosave_temp_2026-09-21_15-17-32.hoi4", 3),
      snapshot("manual-a.hoi4", Date.UTC(2026, 8, 21, 15, 30)),
    ]);

    expect(ordered.map((file) => file.name)).toEqual([
      "autosave_temp_2026-09-21_15-17-32.hoi4",
      "manual-a.hoi4",
      "manual-b.hoi4",
      "autosave_temp_2026-09-21_15-51-56.hoi4",
    ]);
  });

  test("keeps only direct, visible hoi4 files from the selected folder", () => {
    const files = filterSnapshotFolderFiles([
      snapshot("one.hoi4"),
      snapshot("TWO.HOI4"),
      snapshot("one.hoi4.sha256"),
      snapshot(".pending.hoi4"),
      snapshot("README.md"),
      snapshot("nested.hoi4", 0, "snapshots/archive/nested.hoi4"),
    ]);

    expect(files.map((file) => file.name)).toEqual(["one.hoi4", "TWO.HOI4"]);
  });

  test.each([
    [79, 25, 25],
    [10, 25, 10],
    [25, 25, 25],
    [26, 25, 25],
    [79, 10, 10],
    [79, 50, 50],
  ] as const)("samples %i files to target %i", (count, target, expected) => {
    const input = Array.from({ length: count }, (_, index) => index);
    const first = sampleSnapshotFiles(input, target);
    const second = sampleSnapshotFiles(input, target);

    expect(first).toHaveLength(expected);
    expect(new Set(first).size).toBe(expected);
    expect(first[0]).toBe(0);
    expect(first.at(-1)).toBe(count - 1);
    expect(second).toEqual(first);
  });

  test("79 to 25 is approximately uniform and All retains every file", () => {
    const input = Array.from({ length: 79 }, (_, index) => index);
    const sampled = sampleSnapshotFiles(input, 25);
    const gaps = sampled.slice(1).map((value, index) => value - sampled[index]);

    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
    expect(sampleSnapshotFiles(input, "all")).toEqual(input);
    expect(input).toEqual(Array.from({ length: 79 }, (_, index) => index));
  });
});
