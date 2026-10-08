# External alpha: 20-user capacity gate (A3)

Scope: 20 invited users, 30 days, one backend replica, one Worker, two admitted
requests. **CONDITIONAL PASS**, not a production disk/RAM/throughput guarantee.
No production access was performed. Preserve A1 owned-history discovery and the
[A2 persistence outcome](analysis-persistence-outcome.md).

## Measurements and recommendation

Measured locally on 2026-10-08 at A2 baseline `97149dbe`: 13 real saves, one
related campaign spanning 1936–1950 plus three Economy controls. Full current
AnalyzeResult domains, production V2 envelope and default Node gzip. No save
modification or artifact writes. Fixed envelope timestamp; parser timing and
timestamps can change sizes by a few bytes on another run. This is **not** a
cross-mod/ruleset population or VPS benchmark.

| Sample                | Game date | Original bytes | V2 gzip bytes |
| --------------------- | --------- | -------------: | ------------: |
| autosave 1            | 1936.2.1  |     64,970,960 |       122,521 |
| autosave 20           | 1937.9.1  |     68,050,520 |       166,473 |
| autosave 40           | 1939.5.1  |     71,502,419 |       204,220 |
| autosave 60           | 1941.1.1  |     78,711,301 |       316,539 |
| autosave 80           | 1942.9.1  |     95,235,096 |       493,606 |
| autosave 100          | 1944.5.1  |    104,534,765 |       549,706 |
| autosave 120          | 1946.1.1  |    118,967,901 |       591,490 |
| autosave 140          | 1947.9.1  |    114,643,271 |       624,855 |
| autosave 160          | 1949.5.1  |    128,152,134 |       695,403 |
| autosave 178          | 1950.11.1 |    129,604,198 |       692,215 |
| initialized Economy A | 1944.5.1  |    104,307,386 |       549,909 |
| no-trade hour B       | 1944.5.1  |    103,892,551 |       553,229 |
| subject-trade hour C  | 1944.5.1  |    103,893,692 |       553,518 |

Gzip min **122,521**, median **549,909**, mean **470,283.38**, nearest-rank P95
and max **695,403 bytes**. JSON: 2,788,295–10,805,330 bytes. Complexity: 1,225–4,090
divisions, 199–888 equipment definitions, 0–1,279 naval losses. All samples
included Economy, Stockpile, Production and Fielded Equipment. Late-war result
growth matters more than source size alone; no legacy artifact inventory was
available locally.

Cold hash + Worker: median 4,173.95 ms, mean 4,316.99 ms, max 5,905.23 ms.
Immediate same-file RAM reuse (including rehash): median 99.59 ms, mean 95.12 ms,
max 126.88 ms, identical result object/hash. These are not upload/VPS timings.
Identical result/context persistence avoids rewriting a validated artifact;
RAM eviction/process restart can require analysis again.

Reproduce after building `server` (`npm run build`), from repository root:

```bash
node server/scripts/measure-analysis-capacity.cjs \
  saves/autosave_1_temp.hoi4 saves/autosave_20_temp.hoi4 \
  saves/autosave_40_temp.hoi4 saves/autosave_60_temp.hoi4 \
  saves/autosave_80_temp.hoi4 saves/autosave_100_temp.hoi4 \
  saves/autosave_120_temp.hoi4 saves/autosave_140_temp.hoi4 \
  saves/autosave_160_temp.hoi4 saves/autosave_178_temp.hoi4 \
  saves/autosave_100_reload_1192_control_temp.hoi4 \
  saves/post_load_1h_no_trade_control_temp.hoi4 \
  saves/subject_trade_control_temp.hoi4
```

Plan **1 MiB/result**, about 1.51 times measured max. Initial **500 distinct
hashes** (20 × 25) = 500 MiB; measured mean implies 224.25 MiB and max implies
331.59 MiB. Allow **600 additional distinct hashes**: one snapshot/user/day for
30 days. This is an operator assumption, not an enforced per-user quota. Shared
identical original bytes dedup to one hash/artifact; distinct snapshots do not.
Conservative sizing assumes no cross-user dedup savings.

Recommended explicit setting **only after the physical gate**:

```dotenv
HOI4_ANALYSIS_RESULTS_MAX_BYTES=2147483648
```

**2 GiB** allows existing compressed artifacts **E ≤ 512 MiB**, plus 1,100 MiB
planned activity = **1,612 MiB (78.71%)**, leaving 436 MiB logical reserve.
Pre-invite requirement: `E + plannedUniqueHashes × planningUnit ≤ 0.8 × budget`.
Re-measure materially different rulesets; 1 MiB is not a per-artifact cap. If
existing bytes/growth/sizes exceed assumptions, stage invitations or approve a
separately measured bounded expansion. Never raise limits blindly.

The **128 MiB default remains unchanged**, including in the environment example,
to avoid silently resizing deployments. It is below this sample's projected
500-artifact mean workload and is not the cohort recommendation.

## Existing boundaries (now forwarded by base Compose, inherited by alpha)

| Environment setting                  | Unchanged default | Meaning                                                         |
| ------------------------------------ | ----------------: | --------------------------------------------------------------- |
| `HOI4_ANALYSIS_RESULTS_MAX_BYTES`    |         134217728 | Global managed gzip bytes, not disk reservation                 |
| `HOI4_RECENT_ANALYSES_LIMIT`         |               200 | Global Recent horizon; A1 private history is independent        |
| `HOI4_SHARED_ANALYSES_LIMIT`         |              1000 | Share records, not artifact count                               |
| `HOI4_ANALYSIS_CACHE_ENTRIES`        |                 3 | Full results in RAM; count-bounded, not byte-bounded            |
| `HOI4_TRENDS_CACHE_SNAPSHOTS`        |              2048 | Compact projection count                                        |
| `HOI4_TRENDS_CACHE_BYTES`            |          67108864 | Estimated compact projection bytes                              |
| `HOI4_MAX_UPLOAD_BYTES`              |         268435456 | 256 MiB input and normalized transport-gzip plaintext cap       |
| `HOI4_MAX_UNCOMPRESSED_BYTES`        |         536870912 | 512 MiB decoded/ZIP cap, not larger plaintext admission         |
| `HOI4_UPLOAD_TIMEOUT_MS`             |            120000 | Receive/normalize deadline                                      |
| `HOI4_ANALYSIS_TIMEOUT_MS`           |             60000 | Separate Worker deadline                                        |
| `HOI4_ANALYSIS_HEAP_MB`              |              1024 | Worker old-generation heap, not total RSS                       |
| `HOI4_ANALYSIS_WORKERS` / `REQUESTS` |             1 / 2 | Alpha overlay fixes these, even if environment overrides differ |

Storage/count settings accept positive safe integers, otherwise use defaults.
Upload/timer settings additionally cap at signed 32-bit values, requests at 32,
heap at 8192 MiB; invalid Worker count fails startup. Compose does not perform
application validation. Use decimal integers, not `2G`/`128MiB`. Keep admission,
timeouts, input and cache limits unchanged unless separately justified.

There is **no persisted-artifact count cap**. Owned/shared/pinned artifacts are
protected; unknown ownership/share protection fails closed. Existing retention
can reclaim unprotected managed artifacts. When protected bytes prevent a new
write, persistence is declined without evicting protected data. A3 changes none
of these policies. JSON envelopes remain capped at 512 MiB. Atomic replacement
needs an extra temporary artifact. Logical accounting excludes temporary files,
metadata, uploads, DB/WAL, backups, logs, Docker layers and filesystem overhead.
Do not add backend replicas: write queues/protection coordination are local.

Admission covers the upload through analysis/persistence/cleanup, not just body
receipt. Distinct overlapping analyses can receive `ANALYZER_BUSY` at the single
Worker (there is no waiting queue); stagger initial campaign imports. Upload and
Worker deadlines are not an end-to-end persistence/DB deadline. Upload files are
removed on success/failure/disconnect; startup inspects at most 1,000 entries and
removes only recognized regular uploads older than at least six hours. Crash or
cleanup-failure leftovers are additional physical usage, not covered by the
512 MiB **live** staging reserve below; inspect them without destructive recovery.

Separate count-pressure caveat: Recent retains pinned entries first. If all 200
global Recent slots are pinned, a new unpinned record can be omitted and its
persistence declined **even with byte headroom** (existing all-pinned regression).
A1 still preserves already-owned discovery; A3 does not change this policy.
Review global Recent pin occupancy before/during the cohort, and diagnose this
case separately from byte exhaustion. Do not delete history to free slots.

## Read-only operator inspection

Run future operator commands from the deployed checkout, adding **all existing
Compose overrides in their existing order**. Preserve the deliberate production
Caddy override. Never print the full effective config/environment: it contains
credentials. These commands were **not** run against production for A3.

```bash
compose=(docker compose --env-file .env.private-alpha
  -f docker-compose.yml -f docker-compose.private-alpha.yml)

# Intended propagation: print only whitelisted capacity settings.
"${compose[@]}" config --format json | node -e '
  let input=""; process.stdin.on("data", c => input += c);
  process.stdin.on("end", () => {
    const e = JSON.parse(input).services.backend.environment;
    const keys = ["HOI4_ANALYSIS_RESULTS_MAX_BYTES", "HOI4_RECENT_ANALYSES_LIMIT",
      "HOI4_SHARED_ANALYSES_LIMIT", "HOI4_ANALYSIS_WORKERS", "HOI4_ANALYSIS_REQUESTS",
      "HOI4_MAX_UPLOAD_BYTES", "HOI4_MAX_UNCOMPRESSED_BYTES", "HOI4_ANALYSIS_HEAP_MB"];
    console.log(Object.fromEntries(keys.map(k => [k, e[k]])));
  });'

# Effective global budget/inventory; no hashes, filenames or inflation.
"${compose[@]}" exec -T backend node -e '
  const {PersistedAnalysisResultService} = require("./dist/src/analyze/persisted-analysis-result.service");
  new PersistedAnalysisResultService().storageStatus().then(s => {
    const sizes = s.files.map(f => f.bytes).sort((a,b) => a-b);
    console.log({configured: process.env.HOI4_ANALYSIS_RESULTS_MAX_BYTES,
      effectiveMaxBytes: s.maxBytes, totalBytes: s.totalBytes, count: sizes.length,
      largestBytes: sizes.at(-1) ?? null,
      p95Bytes: sizes.length ? sizes[Math.ceil(sizes.length*.95)-1] : null,
      workers: process.env.HOI4_ANALYSIS_WORKERS,
      requests: process.env.HOI4_ANALYSIS_REQUESTS});
  }).catch(() => { console.error("Inventory unavailable"); process.exitCode=1; });'

# Global Recent counters only; do not instantiate its mutating service.
"${compose[@]}" exec -T backend node -e '
  try {
    const fs = require("node:fs");
    const s = JSON.parse(fs.readFileSync(process.env.HOI4_RECENT_ANALYSES_FILE, "utf8"));
    if (!Array.isArray(s.items)) throw new Error();
    console.log({recentRecords: s.items.length,
      recentPinnedRecords: s.items.filter(i => i.pinned === true).length,
      configuredRecentLimit: process.env.HOI4_RECENT_ANALYSES_LIMIT});
  } catch { console.error("Recent counters unavailable"); process.exitCode=1; }'

"${compose[@]}" exec -T backend sh -c \
  'du -sh /app/data /tmp/hoi4-save-tracker; df -h /app/data /tmp; df -i /app/data /tmp'
docker info --format '{{.DockerRootDir}}'
docker system df
df -h /var/backups/hoi4-save-tracker
df -i /var/backups/hoi4-save-tracker
du -sh /var/backups/hoi4-save-tracker/analysis-history /var/backups/hoi4-save-tracker/postgres
"${compose[@]}" stats --no-stream backend postgres
systemctl status hoi4-host-health.timer hoi4-analysis-history-backup.timer \
  hoi4-postgres-backup.timer hoi4-offsite-backup.timer --no-pager
```

Use actual upload/backup paths if different. Inventory counts bytes, not artifact
health. `/api/storage` reports one user's owned logical bytes, **not global
occupancy**. Local synthetic propagation check (no daemon/containers or real
environment file): `node server/scripts/verify-capacity-compose.cjs`.

## Pre-invite physical gate

1. Confirm A1/A2 already installed, private history/reopening and persistence
   outcomes healthy. A3 needs no migration. Measure E and pass the 80% sizing
   inequality; verify intended **and running** capacity values and spare Recent
   record slots under the current pin policy.
2. Inspect every filesystem holding live data, container writable layers/uploads,
   backup/verification staging, PostgreSQL/WAL and Docker images. Production
   physical space/inodes, memory/swap and CPU remain unmeasured in A3.
3. Reserve **512 MiB** upload disk: 2 × 256 MiB at current admission/input caps.
   Gzip streams directly into normalized plaintext, not a second whole compressed
   disk file. ZIP expansion is in bounded Worker memory. Reserve **1 GiB** for
   one atomic replacement and overhead, separately from final artifact bytes.
4. Budget history backups: default **7 retained complete archives**, plus **one
   in-progress archive**, **one extracted validation copy** in a container and
   **one downloaded offsite verification copy**. At projected generation size H
   approximately 2 GiB plus metadata/tar overhead, these total approximately
   **10 × H**, in addition to live artifacts. Do not assume already-compressed
   JSON shrinks substantially in tar/gzip. Use actual retention/schedule, allow
   overlapping jobs, account for each mount once, and subtract only **growth**
   from today's free space (existing copies are already used). R2 is append-only;
   remote cost grows independently. Backups remain unchanged.
5. Separately budget DB/WAL, seven local DB generations, OS/images/build peaks and
   bounded logs. Require **at least 5 GiB and more than 20% free after projected growth/reserves** on
   affected filesystems, plus free inodes (existing host-health warning bounds).
   Rough conservative live/history/transient/free allowances at a 2 GiB cap are
   **28.5 GiB before DB/OS/metadata overhead**. A nominal 20–40 GiB VPS is not
   automatically sufficient; provision capacity or stage fewer invitations.
6. Measure actual VPS behavior with a largest representative save, two admitted
   uploads and 25-snapshot Trends/Intelligence reads. Heap is not RSS: parent
   results/caches and ZIP inflation add memory. Confirm no OOM, acceptable busy/
   retry behavior, and backup duration within timer windows. The 500 synthetic
   upload test stubs computation; it is not a VPS throughput/load benchmark.
7. Verify readiness, host-health/timers, a validated local backup pair and latest
   successful offsite verification journal per the
   [operations runbook](private-alpha-operations-runbook.md). R2 can legitimately
   lag newer local backups; never force replication merely to make them equal.

## Rollout, monitoring, limits and safe restoration

- Only after this gate and separate approval, record old whitelisted settings/
  overrides and edit **only the approved capacity value** in the private operator
  environment. Environment changes need backend **recreation**, not `restart`,
  in the established maintenance/deployment workflow. Preserve volumes/Caddy/
  backup config; recheck effective limit, readiness, owned reopening and shares.
  A3 did not modify a real environment file or perform a rollout.
- Check global bytes/count/growth and physical bytes/inodes daily and after large
  imports, plus memory/busy/timeouts/backup duration. At **80% logical occupancy**
  or growth above plan, pause invitations/large imports and re-budget. Existing
  host-health does not alert on logical quota; A3 adds no alert. Temporary outcome
  alone is not proof of quota exhaustion: inspect bytes, permissions, disk and DB.
- At protected-cap exhaustion, single computation remains **temporary/not saved**
  without `X-Analysis-Hash`; batch returns `PERSISTENCE_FAILED`. Do not promise
  reopening, sharing, Compare, Trends or Intelligence for a temporary result.
  Keep the original save for explicit Retry saving after fixing the cause. RAM
  reuse is opportunistic, not guaranteed after eviction/process recreation.
- Recover by provisioning space, a measured bounded increase or restoring healthy
  permissions/metadata/DB. Then users explicitly retry. **No user-data deletion,
  volume removal, Docker prune, history/backup/R2 cleanup or destructive rollback
  is authorized here.**
- Restore reviewed configuration through the same maintenance procedure if needed.
  Lowering the cap can reject writes and evict **unprotected** artifacts under
  existing policy. A non-destructive restoration must keep the effective cap at
  least current total managed bytes; never blindly revert to 128 MiB. Preserve
  all data/overrides and verify health.

Known limits: unmeasured independent-player artifact distributions, physical VPS
capacity/throughput, simultaneous heavy readers, registration abuse, indefinite
retention and commercial demand. No worker increase, queue/storage rewrite,
per-user plan, new gameplay feature or backup changes are introduced.
