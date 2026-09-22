import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(clientDirectory, "..");
const canonicalPath = resolve(
  repositoryDirectory,
  "tools/hoi4-save-snapshotter/snapshotter.ps1",
);
const stagedPath = resolve(
  clientDirectory,
  "public/downloads/hoi4-save-snapshotter.ps1",
);
const builtPath = resolve(
  repositoryDirectory,
  "server/client/dist/downloads/hoi4-save-snapshotter.ps1",
);

async function assertIdentical(actualPath, expectedContents, description) {
  let actualContents;
  try {
    actualContents = await readFile(actualPath);
  } catch (error) {
    throw new Error(`${description} is missing: ${actualPath}`, { cause: error });
  }

  if (!actualContents.equals(expectedContents)) {
    throw new Error(`${description} does not match the canonical snapshotter.`);
  }
}

const mode = process.argv[2];
const canonicalContents = await readFile(canonicalPath);

if (mode === "sync") {
  await mkdir(dirname(stagedPath), { recursive: true });
  await writeFile(stagedPath, canonicalContents);
  await assertIdentical(stagedPath, canonicalContents, "Staged download asset");
} else if (mode === "verify-build") {
  await assertIdentical(builtPath, canonicalContents, "Production download asset");
} else {
  throw new Error("Usage: node scripts/snapshotter-asset.mjs sync|verify-build");
}
