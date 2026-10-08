/* Local, read-only capacity probe. Build server first; pass explicit save paths.
 * No HTTP, database, persisted-artifact writes, or save modifications.
 * Uses the production Worker/cache and the production V2 gzip envelope.
 */
'use strict';

const { lstat } = require('node:fs/promises');
const { basename, resolve } = require('node:path');
const { performance } = require('node:perf_hooks');
const { promisify } = require('node:util');
const { gzip } = require('node:zlib');
const {
  Hoi4AnalysisWorkerService,
} = require('../dist/src/hoi4/hoi4-analysis-worker.service');
const {
  AnalysisResultCacheService,
} = require('../dist/src/hoi4/analysis-result-cache.service');

const compress = promisify(gzip);
const round = (number) => Math.round(number * 100) / 100;

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    min: sorted[0],
    median:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p95NearestRank: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}

async function main() {
  const paths = process.argv.slice(2).map((file) => resolve(file));
  if (!paths.length) throw new Error('Pass explicit local .hoi4 save paths.');
  // One worker, one file at a time. Never change the production configuration.
  process.env.HOI4_ANALYSIS_WORKERS = '1';
  process.env.HOI4_ANALYSIS_CACHE_ENTRIES = '1';
  delete process.env.HOI4_REQUEST_PROFILE;
  const worker = new Hoi4AnalysisWorkerService();
  const cache = new AnalysisResultCacheService(worker);
  const samples = [];
  try {
    for (const path of paths) {
      const before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink())
        throw new Error(
          'Only explicitly selected regular save files are allowed.',
        );
      const coldStart = performance.now();
      const analysis = await cache.analyzeWithHash(path);
      const coldMs = round(performance.now() - coldStart);
      const warmStart = performance.now();
      const reused = await cache.analyzeWithHash(path);
      const reusedMs = round(performance.now() - warmStart);
      if (analysis.hash !== reused.hash || analysis.result !== reused.result)
        throw new Error('Expected identical RAM cache reuse.');
      const after = await lstat(path);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new Error(
          'Source changed during measurement; discard this sample.',
        );
      const envelope = {
        formatVersion: 2,
        hash: analysis.hash,
        savedAt: '2026-10-08T00:00:00.000Z',
        comparisonContext: analysis.comparisonContext,
        result: analysis.result,
      };
      const json = JSON.stringify(envelope);
      const compressed = await compress(json);
      const result = analysis.result;
      const sample = {
        file: basename(path),
        sourceBytes: before.size,
        gameDate: result.game_date,
        jsonBytes: Buffer.byteLength(json),
        gzipBytes: compressed.length,
        coldMs,
        reusedMs,
        parseSeconds: result.parse_seconds,
        countries: result.by_country.length,
        divisions: result.divisionSummaries.reduce(
          (sum, country) => sum + country.divisions.length,
          0,
        ),
        equipmentDefinitions: result.divisionEquipmentCatalog.length,
        navalLosses: result.navalLosses.length,
        domains: {
          stockpileCountries: result.stockpileSummaries.length,
          productionCountries: result.militaryProductionSummaries.length,
          economyCountries: result.economy?.countrySummaries.length ?? null,
          fieldedCountries: result.fieldedEquipmentSummaries.length,
        },
      };
      samples.push(sample);
      console.log(JSON.stringify({ sample }));
      cache.delete(analysis.hash);
    }
    console.log(
      JSON.stringify({
        summary: {
          envelopeVersion: 2,
          compression: 'node:zlib gzip, production defaults',
          gzipBytes: stats(samples.map((sample) => sample.gzipBytes)),
          coldMs: stats(samples.map((sample) => sample.coldMs)),
          reusedMs: stats(samples.map((sample) => sample.reusedMs)),
        },
      }),
    );
  } finally {
    await worker.onModuleDestroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
