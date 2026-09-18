# HOI4 binary save support: Phase 0 architecture spike

Research date: 2026-09-18

## Executive decision

The sound architecture is:

```text
untrusted .hoi4 upload
  -> existing upload admission and container validation
  -> bounded raw save payload (ZIP entry or uncompressed file)
  -> if HOI4txt: existing UTF-8 decoding path
  -> if HOI4bin: isolated, pinned HOI4-aware Rust melter
  -> bounded HOI4txt output
  -> existing text parser and every existing analyzer
  -> existing cache, persistence, ownership, Compare, Trends, and reports
```

There should not be a second implementation of country, industry, war,
division, naval, stockpile, or production analysis. Binary support is an input
normalization concern only.

The recommended decoder is a small project-owned Rust executable using the
current `hoi4save` implementation and `jomini`, invoked without a shell from
the existing analysis Worker. It should expose a deliberately tiny, stable
protocol and fail closed on every unknown token. A general Rakaly CLI binary
is a useful reference and spike tool, but it is a larger and less controlled
production dependency. A native shared library is not recommended because it
moves untrusted native parsing into the Node process.

Production implementation is **blocked until the project has a documented,
acceptable source and distribution right for a current HOI4 token resolver**.
The parser libraries are MIT, but their own documentation says the resolver
data cannot be distributed with the library per Paradox Development Studio
counsel. The current upstream build infrastructure obtains the resolver from a
private repository. This spike found no public, licensed resolver artifact or
supported procedure for deriving one from a game installation.

## 1. Current architecture

### 1.1 Request and upload path

The normal browser request is `POST /api/analyze` in
`server/src/analyze/analyze.controller.ts`. Authentication and CSRF are global
HTTP boundaries; local server-path input is separately gated and disabled by
default. The controller accepts either a multipart upload or an explicitly
enabled local save path.

`SaveUploadInterceptor` owns the request before multipart parsing. It:

- limits request admission before consuming the body;
- accepts one `.hoi4` file and writes it with exclusive creation to a private
  upload directory;
- enforces upload size, multipart field/part/header limits, and an upload
  deadline;
- cleans the temporary upload after controller success, validation failure,
  cache hit, Worker failure/crash/timeout, persistence failure, or client
  abort;
- removes only matching stale upload files during bounded startup cleanup.

The controller then calls `validateSaveFile()`, hashes the original uploaded
bytes with SHA-256, and calls `AnalysisResultCacheService.analyzeWithHash()`.
The original-byte hash remains the cache and persisted-artifact identity. A
binary input and a separately produced text input for the same game state will
therefore have different hashes; Phase 1 should preserve that existing
semantic rather than introduce a canonical-content migration.

On success, `RecentAnalysesService.record()` persists the derived result and
comparison context, then records the authenticated user/hash ownership
relation. The uploaded `.hoi4` file is temporary and is not retained. Reopen,
Compare, Campaign Trends, exports, reports, storage management, and shares read
the persisted derived result without another parse.

### 1.2 Validation and format detection

`server/src/hoi4/save-container.ts` accepts:

- an uncompressed `HOI4txt` file, with an optional UTF-8 BOM; or
- a deliberately narrow ZIP container with exactly one `gamestate` or
  leaf-name `.hoi4` entry.

ZIP validation rejects split archives, ZIP64, encryption, links/directories,
unsupported methods, unsafe names, excess entries/directory bytes, invalid
local/central metadata, invalid CRC, and inconsistent sizes. Inflation has a
hard `maxOutputLength`, independent of declared ZIP metadata.

Binary detection is the seven-byte `HOI4bin` header. The exact current
rejection is `checkPlainPrefix()` in `save-container.ts`:

```text
HOI4bin -> SaveInputError('UNSUPPORTED_BINARY_SAVE')
```

For an uncompressed binary file this happens in the controller's bounded
pre-validation. A ZIP-wrapped binary payload passes ZIP metadata validation
without inflation and is rejected later, after bounded inflation in the
Worker. Both paths return the same safe 422 code and guided UI message.

### 1.3 Worker and parser boundary

`Hoi4AnalysisWorkerService` starts a Node Worker with the file path and the
explicit upload policy. The default is one active analysis Worker per backend
process (`HOI4_ANALYSIS_WORKERS=1`), with a 60-second hard analysis deadline
and a 1,024 MiB V8 old-generation limit. All Worker completion, error, exit,
and timeout paths converge before the slot is released.

The Worker calls `analyzeSave()` with validation enabled. `readSaveText()` is
the only full file read and ZIP inflation. It produces one bounded `Buffer`,
checks the `HOI4txt` prefix, decodes UTF-8, and returns a JavaScript string.
`analyzeSave()` then builds shared structural indexes and runs the mature text
analyzers.

This is the minimum integration boundary:

```text
save-container: validated, bounded payload Buffer
                       |
             HOI4txt --+--> decodeSaveText()
             HOI4bin --+--> binary melter --> HOI4txt bytes
                                             |
                                      decodeSaveText()
                                             |
                               existing analyzeSave text body
```

Phase 1 will need to extract the downstream text analysis into an internal
function that accepts an already decoded string. That is a mechanical entry
point split, not a parser rewrite. Plaintext must continue through exactly its
current path.

### 1.4 Existing limits

The current defaults are:

| Boundary | Current default |
| --- | ---: |
| Raw upload | 256 MiB |
| Uncompressed ZIP/plain payload | 512 MiB |
| Upload timeout | 120 seconds |
| Whole analysis timeout | 60 seconds |
| Concurrent admitted requests | 2 |
| Concurrent analysis Workers | 1 |
| Worker V8 old-generation limit | 1,024 MiB |
| ZIP entries | 1 accepted (hard maximum metadata guard: 8) |

These bounds protect the current Node path. A native child process is not
covered by the Worker V8 heap limit and needs its own controls.

### 1.5 Current tests and corpus

Relevant suites already cover:

- raw and ZIP text saves, BOM/Unicode decoding, malformed input, and structural
  validation;
- raw and ZIP binary rejection;
- forged ZIP sizes, decompression caps, invalid CRC/metadata, and corrupt ZIPs;
- multipart admission, limits, timeout, client abort, and temporary-file
  cleanup across success and failure paths;
- Worker result/error/exit/timeout races and slot release;
- hash cache/in-flight deduplication;
- persistence, ownership, and API behavior.

The binary test fixture is only a synthetic `HOI4bin` prefix. A header survey
of the repository's `saves/` directory found 179 `HOI4txt` files and no real
binary save. A modern real binary fixture is therefore an acceptance blocker
for Phase 1, even after the resolver question is settled.

## 2. Binary format findings

### 2.1 Current upstream organization

The archived [`rakaly/hoi4save`](https://github.com/rakaly/hoi4save) repository
states that it was consolidated into the main
[`rakaly/jomini`](https://github.com/rakaly/jomini) repository. The inspected
Jomini source revision was
[`e27f87b6bd245602a6f324b35838321abe46986a`](https://github.com/rakaly/jomini/commit/e27f87b6bd245602a6f324b35838321abe46986a)
(2026-09-16). Its workspace contains `hoi4save` 0.4.0 against Jomini 0.36.

The version number alone is misleading. The immutable crates.io/docs.rs
`hoi4save 0.4.0` release is from 2025 and its
[`flavor.rs`](https://docs.rs/crate/hoi4save/0.4.0/source/src/flavor.rs)
contains only the legacy four-byte `0x000d` handling. It does **not** contain
the modern stateful implementation now present in the repository.

### 2.2 HOI4 1.17 / save_version 30

[`jomini#233`](https://github.com/rakaly/jomini/issues/233) documents the
breaking change: in HOI4 1.17 (`save_version=30`), token `0x000d`, historically
a four-byte fixed-point value, carries an eight-byte fixed-point value. A
format-agnostic reader becomes desynchronized if it consumes only four bytes.

Jomini 0.35.0 added the stateful `BinaryFormat` extension point. The HOI4 fix
was merged as
[`hoi4save@dd4879835b45ea2197a6e89e73e794b4e4f930c1`](https://github.com/rakaly/hoi4save/commit/dd4879835b45ea2197a6e89e73e794b4e4f930c1)
on 2026-07-12. `Hoi4BinaryFormat` observes token `0x349d`
(`save_version`), records the following I32 value, and consumes eight bytes for
`0x000d` when that value is at least 30. The same rule is used while skipping
nested values, which is essential to remain synchronized.

The current upstream tests include a real
`1.17-new-ironman-format.hoi4` fixture plus a focused regression whose high
four bytes resemble a closing token. Those tests exercise both parsing and
skipping modern fixed-point values.

The practical minimum verified combination is:

- Jomini **0.35.0 or newer**, because that introduced the required stateful
  format extension; and
- the HOI4 implementation at commit **`dd487983…` or newer**.

Rakaly CLI v0.8.19 pins exactly Jomini 0.35.0 and `hoi4save@dd487983…` in its
`Cargo.lock`, so its decoder includes the 1.17 fix. A custom helper must pin an
exact known-good Git revision (and commit `Cargo.lock`); depending on published
`hoi4save = "0.4.0"` is not sufficient. Once upstream publishes a distinct
crate version containing this code, that release may replace the Git pin only
after fixture verification.

The latest released librakaly inspected here, v0.12.7 (2026-05-15), pins
Jomini 0.34.0 and `hoi4save@3a1b76c…`, predating the July fix. It must not be
assumed to support HOI4 1.17/save_version 30. Current librakaly source has moved
to newer dependencies, but no inspected release establishes that support.

### 2.3 What melting preserves

`Hoi4File` recognizes `HOI4txt` and `HOI4bin`. For binary input its melter
writes a `HOI4txt` header followed by Clausewitz text. This matches the current
parser's expected boundary and avoids duplicating domain analysis.

The custom helper should use:

```text
MeltOptions
  verbatim = true
  on_failed_resolve = Error
```

It should melt, not deserialize into the upstream `Hoi4Save` model. This
project consumes many structures beyond that small model; melting retains the
complete save for the existing parser.

An explicit maximum verified `save_version` is preferable to silently
accepting a future format. The current implementation treats every version
`>=30` as having the same `0x000d` rule. Phase 1 should report the observed
version and reject versions above the highest fixture-verified version until a
fixture proves compatibility. This is conservative but prevents a structurally
plausible, semantically wrong analysis after a game update.

## 3. Token Resolver Feasibility

Phase 0B investigated whether the otherwise viable decoder architecture has a
complete, maintainable, and defensibly usable resolver source for a public
SaaS. It did not download, inspect, or copy any resolver dataset. Findings
below come from public source, public build workflows, upstream documentation,
and published platform terms. Legal conclusions remain outside this technical
spike.

### 3.1 A resolver is mandatory

Most binary keys are 16-bit numeric IDs. `BasicTokenResolver` reads lines such
as:

```text
0xffff key_name
```

An empty resolver may compile and is enough for plaintext examples, but it
cannot produce meaningful binary Clausewitz keys. In particular, the existing
parser depends on exact names such as `countries`, `history`, `production`,
and `save_version`.

### 3.2 Upstream provenance

The HOI4 library README says binary saves require a resolver and that the
resolver cannot be distributed with the library "per PDS counsel." Resolver
files are absent from, and ignored by, the public repositories.

Current Rakaly CLI source uses `include_bytes!("assets/tokens/hoi4.txt")`.
Its CI workflow clones the private `pdx-tools/tokens` repository with a secret
PAT for trusted builds and refuses a trusted build when that secret is absent.
The public PDX Tools README similarly says binary support is available only
"if you are in possession of a binary token file."

The 2026 Jomini consolidation did not change this boundary. Current Jomini
contains the resolver interface, text-file loader, binary reader, and the HOI4
format/melter, but not the HOI4 token-to-string dataset. Its
[`BasicTokenResolver`](https://github.com/rakaly/jomini/blob/master/crates/jomini/src/binary/resolver.rs)
still consumes an external mapping. Current PDX Tools likewise documents an
operator-supplied `assets/tokens/hoi4.txt`; no public generation task or token
artifact was found.

The latest public librakaly documentation still instructs source builders to
provide `HOI4_IRONMAN_TOKENS`. Its current token module, like the CLI, compiles
`assets/tokens/hoi4.txt` into the library. That is a packaging mechanism, not a
source for the mapping.

Therefore:

- Jomini/hoi4save do not bundle resolver data;
- a normal source build without private data creates an empty resolver file;
- upstream release binaries may contain resolver data, but the public source
  does not establish a license or provenance that grants this project the
  right to extract or redistribute that data;
- this project must not commit a resolver, bake it into an image, fetch it
  from an unofficial service, or copy it from an upstream binary without an
  explicit legal/provenance decision.

Acceptable Phase 1 paths are either (a) documented permission to redistribute
a versioned resolver, or (b) an operator-provided resolver mounted read-only at
runtime under a process approved by counsel. No supported way to derive a
complete current resolver from an installed HOI4 copy was established in this
spike. A SaaS server also cannot assume access to a user's game installation.

### 3.3 Unknown tokens

Current `hoi4save` can error, ignore, or stringify an unresolved token. During
melting, non-error modes emit a placeholder similar to
`__unknown_0x1234` and record the unknown ID. Rakaly CLI returns a nonzero
status when stringify mode encountered unknown tokens.

Stringification preserves bracket/token alignment but not the field's
semantic name. It is not sufficient for this analyzer: an unknown token could
be a harmless new field or could be `countries`, a casualty field, an
equipment identity, or another key that controls totals. The downstream parser
cannot distinguish those cases and could return a plausible partial result.

Production must therefore fail closed if **any** unknown token occurs. The
safe response is a stable, user-facing "binary resolver is out of date" error;
the unknown numeric IDs may be logged only in bounded server diagnostics. A
stringify mode is useful only for offline diagnostics and fixture research,
never for public analysis results.

### 3.4 Update policy

The resolver and decoder are separate compatibility dimensions:

- content patches can add token IDs without changing the binary wire format;
- engine patches can change token encoding, as version 30 did.

Every deployed decoder should identify:

- helper build version and exact source revision;
- Jomini and HOI4 implementation revisions;
- resolver version/source and SHA-256 digest;
- highest fixture-verified HOI4 game/save version.

Unknown tokens or a higher save version should trigger a controlled upgrade,
not fallback analysis. Resolver upgrades need regression fixtures and the same
release review as decoder upgrades.

### 3.5 Exact resolver contract

Jomini's public `BasicTokenResolver` documents the transport format, not the
authoritative contents. Each non-empty line is a four-digit hexadecimal token,
one space, and its text value, for example `0xffff key_name`. The resolver
returns a string for a 16-bit token. The public loader accepts duplicate token
IDs by keeping the last value; a production validator should instead reject
duplicates so that file order cannot silently change semantics.

This mapping is required for values as well as keys. Struct annotations for a
few known keys cannot replace it: binary tokens can occur where the parser is
reading a string value, and this analyzer first melts the whole binary document
before its existing text parser selects relevant subtrees. A complete resolver
for an accepted save therefore means **every token encountered in that save has
one unambiguous text mapping**. It does not mean every token ever allocated by
HOI4 must already be present, but an incomplete per-save mapping must fail the
request rather than produce a partial result.

The binary payload itself is not a dictionary. It can reveal which numeric IDs
occur and can contain literal strings, but it does not generally carry the
missing ID-to-name association. Repeated saves can improve coverage statistics;
they cannot prove that numeric token `0x1234` means a particular field.

### 3.6 Why a Rakaly CLI release can melt HOI4 saves

The working release path is visible in the public v0.8.19
[`tokens.rs`](https://github.com/rakaly/cli/blob/v0.8.19/src/tokens.rs),
[`build.rs`](https://github.com/rakaly/cli/blob/v0.8.19/build.rs), and
[`ci.yml`](https://github.com/rakaly/cli/blob/v0.8.19/.github/workflows/ci.yml):

1. the CLI token module uses `include_bytes!` for
   `assets/tokens/hoi4.txt`;
2. trusted CI checks out the separate private `pdx-tools/tokens` repository into
   that assets directory using a secret PAT;
3. Rust embeds those bytes in the release executable at compile time;
4. the `melt` command passes the embedded resolver to the HOI4 melter.

A normal public-source checkout does not reproduce that artifact. Its build
script creates empty token files when the private assets are absent, allowing
compilation but not meaningful HOI4 binary decoding. This explains the observed
difference between a downloadable Rakaly executable and a locally built public
checkout.

That evidence establishes how bytes reach the executable. It does **not**
establish how the private mapping was originally generated, whether it is
official or reverse engineered, what versions it covers, or whether another
project may extract, host, redistribute, or use it in a public service. A
working executable is therefore a useful compatibility oracle, but not an
acceptable resolver provenance record.

### 3.7 Resolver-source investigation

| Candidate source | What the public evidence establishes | Completeness/versioning | Headless server viability | Feasibility conclusion |
| --- | --- | --- | --- | --- |
| Official HOI4 installation | No documented token export file, command, API, debug switch, or stable asset was found. No installed copy was available in the standard local Steam locations for a bounded verification. | Unknown; game assets change with patches. | A SaaS host cannot assume a licensed user installation. | **Not an established source.** |
| Steam-distributed HOI4 files | No documented distributed resolver file or stable asset containing the numeric-to-string table was found. Local extraction remains an unproven mechanism, distinct from permission to reuse extracted data. | Unknown and patch-coupled. | Requires a licensed installation and an extraction process that does not currently exist. | **Not an established source.** |
| Game-generated debug/log output | No documented launch option, console command, log, or dump that exports the HOI4 binary token table was found. Ordinary saves expose numeric usage, not the dictionary. | At best session/save-specific unless the engine exports its full registry. | Could be automated only after a supported export mechanism is identified. | **Not an established source.** |
| Paradox-provided API/tool/file | No public Paradox API, SDK, tool, or documentation for obtaining the HOI4 token resolver was found. | Unknown. | Would be the preferred authoritative source if Paradox supplies one. | **Not currently available.** |
| Public Jomini/hoi4save source | Supplies the resolver interface and loader only. The archived hoi4save README explicitly says the resolver cannot be distributed with the library per PDS counsel. | No mapping included. | Library is headless; data is absent. | **Necessary decoder, not a resolver source.** |
| Public Rakaly CLI/librakaly source build | Embeds an external file; public builds create an empty placeholder unless the operator supplies tokens. | Determined entirely by the supplied private file. | Technically headless. | **Packaging mechanism, not provenance.** |
| Rakaly release executable | Contains enough embedded data for supported saves because trusted CI injects a private repository. | Release-coupled and opaque; coverage metadata is not published. | Technically usable as a subprocess. | **Reject for deployment until data provenance and rights are documented.** |
| PDX Tools | Public documentation requires the operator to possess `assets/tokens/hoi4.txt`; its public repository does not provide a HOI4 generation method or artifact. | External/unknown. | Technically headless once supplied. | **Consumer, not source.** |
| Binary save corpus | Reveals used numeric IDs and literals, not the authoritative names of unresolved IDs. | Save-specific and semantically incomplete. | Automatable but cannot reconstruct names. | **Insufficient by construction.** |
| Community token tables or compiled mappings | At least one public third-party project contains a compiled token resolver, but no authoritative provenance or reusable token-data permission was found. | Project-specific and potentially stale. | Technically usable. | **Do not download, copy, or ship without provenance and rights.** |
| User-supplied resolver | The user could provide a mapping they are authorized to use. | User-dependent; must be validated and versioned. | Can be transiently mounted or uploaded, but creates a new untrusted-input and support surface. | **Technically possible, poor transparent-SaaS UX, requires policy/legal review.** |
| Written Paradox permission plus a versioned artifact/process | Would provide the missing authority and an auditable update source if the grant covers server-side use and distribution model. | Can be explicit and release-managed. | Yes. | **Only clear route to transparent server-side support found.** |

These modes have distinct rights questions. Reading an artifact from a user's
own installation, copying or embedding it in distributed software, and using a
user-supplied mapping transiently on a hosted server are not interchangeable.
Technical feasibility for one does not authorize the others.

### 3.8 Can a minimal resolver be safe?

No minimal allowlist was found that preserves the current analyzer's correctness
boundary. The proposed helper melts the complete save before the TypeScript
parser ignores unrelated fields. With the required error policy, an unknown
token anywhere aborts. With stringify or ignore behavior, an unknown token can
be a relevant key or value and the analyzer can return convincing but wrong
totals.

A selective binary parser would not solve this cheaply. Before resolving a key,
it cannot know whether that subtree is relevant, and tokenized values still
need names. Implementing selection at the binary layer would create a second,
HOI4-version-sensitive parser and would contradict the approved reuse of the
existing text pipeline. A curated list of currently referenced parser keys is
therefore neither complete nor a safe Phase 1 shortcut.

### 3.9 Architectures when redistribution is unavailable

| Architecture | User experience | Security/operations | Update model | Private Alpha | Public SaaS |
| --- | --- | --- | --- | --- | --- |
| Server-owned installed game | Transparent after deployment, but requires the service operator to install and maintain HOI4. | Couples production to a consumer game installation and credentials; no documented resolver extraction step exists. | Patch the installation and regenerate by an unknown process. | Not defensible from current evidence. | Reject. |
| User uploads a resolver with the save | High friction and unintelligible to normal users; most users do not possess one. | Treat as untrusted input, bound size/grammar, never persist by default, and prevent cross-user reuse. Provenance remains the user's responsibility. | Per request or explicit user-managed versions. | Possible only as an expert experiment after policy review. | Poor product fit. |
| Local companion performs melting | User installs a native tool; normal upload resumes with plaintext output. Tokens and game access can remain on the user's device. | Requires signed/updateable binaries, local file access disclosure, and a secure handoff. It still needs a legitimate local resolver source. | Companion and resolver update independently with compatibility checks. | Best fallback to investigate if an approved local source exists. | Not transparent browser-only SaaS. |
| Browser/WASM decoder | Avoids server possession but requires the browser to obtain the same resolver and process very large saves. | Browser memory, file APIs, resolver exposure, and update integrity add risk. | Ship decoder/resolver to every client. | Not realistic without redistribution permission. | Reject under current constraints. |
| Server runs a downloaded Rakaly release | Browser-only and technically straightforward. | Executes a third-party binary containing opaque private data; cannot audit resolver version/provenance and inherits its broad CLI surface. | Replace whole CLI release and rerun fixtures. | Research oracle only. | Reject. |
| Plaintext-only with guided recovery | Existing secure path; user changes `save_as_binary=no` and re-saves. | No new native/token boundary. | None. | **Recommended now.** | **Recommended now.** |
| Server helper plus authorized external resolver | Transparent browser upload and matches the Phase 0 architecture. | Resolver is a read-only deployment secret/artifact with digest, strict validation, and fail-closed behavior. | Explicit resolver releases and fixture gates. | Suitable after permission/provenance gate. | Preferred end state after the gate. |

No public third-party decode service was found with a documented HOI4 resolver
license, privacy contract, version SLA, and bounded API suitable for forwarding
users' saves. Sending saves to an opaque service would also violate the current
local-processing and data-boundary expectations.

### 3.10 Licensing evidence and review boundary

The decoder code and token data are separate artifacts. Rakaly CLI, Jomini,
hoi4save, and librakaly publish permissive code licenses; those licenses do not
automatically cover a privately injected token table.

The current Paradox User Agreement describes a limited, personal,
non-transferable, non-exclusive, non-commercial service license unless
otherwise agreed, and distinguishes original user content from Paradox or
third-party material. The Steam Subscriber Agreement likewise describes a
personal, non-commercial content/services license and restricts copying,
distribution, and reverse engineering except where the agreement or applicable
law permits. These are relevant published constraints, not a legal conclusion.

Before any resolver is copied, generated from game assets, embedded, mounted on
a public server, or redistributed with a helper, counsel or an authorized
rights holder must confirm the exact proposed operation. This spike cannot turn
technical accessibility into permission.

### 3.11 Resolver version and update strategy if authorized

If an authorized source becomes available, keep resolver lifecycle independent
from decoder releases:

1. Store it outside Git and container images as a read-only deployment artifact.
2. Record source/provenance, written permission scope, resolver revision,
   supported game range, creation date, byte size, and SHA-256 digest.
3. On startup, validate the digest, strict line grammar, 16-bit range,
   uniqueness, non-empty mappings, and a small known-token self-test. Fail
   readiness rather than start binary support with an invalid resolver.
4. Test old and new binary fixtures, unknown-token failure, malformed input,
   highest supported `save_version`, and final `AnalyzeResult` equivalence with
   trusted plaintext controls.
5. Promote atomically, restart workers, retain one verified rollback artifact,
   and log only bounded unknown numeric IDs. Never learn mappings from requests
   or auto-fetch an unauthenticated community file.
6. Treat a new game patch as unsupported until the resolver and decoder fixture
   matrix passes. A resolver-only update must not silently raise the verified
   binary-format/save-version ceiling.

### 3.12 Decision matrix and Phase 1 gate

| Criterion | Required for Phase 1 | Current evidence | Result |
| --- | --- | --- | --- |
| Current HOI4 binary decoder | Version-30-capable, pinned, testable implementation | Current Jomini/HOI4 implementation and the verified post-1.17 fix exist | Pass |
| Complete resolver mechanics | Strict 16-bit mapping loader and fail-closed unknown handling | Public Jomini implementation exists | Pass |
| Reproducible resolver source | Documented process/artifact that this project can obtain | Rakaly trusted CI uses a private repository; no public official source/generator found | **Fail** |
| Rights/provenance | Documented authority for the chosen server-side or redistribution mode | Public code licenses do not establish token-data rights | **Fail** |
| Version/update metadata | Auditable resolver coverage and release process | Not published for the embedded Rakaly dataset | **Fail** |
| Safe user experience today | No plausible partial analysis | Plaintext recovery exists; binary must remain rejected | Pass with plaintext-only behavior |

**Phase 1 verdict: BLOCKED.**

Transparent server-side binary support is technically viable, but implementation
must not begin without a reproducible and defensibly usable resolver source.
There is no exact public resolver artifact or documented official extraction
mechanism this project can name today. Rakaly releases demonstrate decoder
functionality; their private CI dependency does not satisfy this project's
provenance and deployment requirements.

The next phase is a provenance/permission gate, not a coding phase:

1. Request written guidance from Paradox covering the intended token acquisition
   method, server-side use, container/deployment storage, and any distribution
   to users.
2. Ask the Rakaly/PDX Tools maintainers to document the private mapping's source,
   generation/update process, coverage metadata, and whether its use can be
   authorized for this service. Do not request or copy the dataset before that
   authority is established.
3. If a written grant and versioned source are obtained, resume the existing
   Phase 1 helper/fixture plan with the controls in section 3.11.
4. Until then, retain the guided `save_as_binary=no` recovery path. Investigate
   a local companion only if an approved user-local resolver source is found.

## 4. Evaluated integration options

| Option | Correctness/current-version status | Isolation and security | Maintenance/deployment | Decision |
| --- | --- | --- | --- | --- |
| A. Bundle Rakaly CLI | v0.8.19 pins the verified 1.17-capable HOI4 commit and defaults to unknown-token errors. | Separate process is good; CLI accepts fixed args. It still has a broad command surface and a human-oriented stderr/exit protocol. | Prebuilt cross-platform artifacts exist and code is MIT. Resolver is embedded from a private source and its redistribution/provenance remains unresolved. CLI updates are coupled to unrelated games/features. | Useful for a spike and oracle; not the preferred production contract. |
| B. Small Rust helper using current `hoi4save`/Jomini | Exact pinned implementation, error policy, version gate, and output protocol are under project control. | Separate process contains Rust panics/crashes. `spawn` with `shell:false`, bounded streams, deadlines, and explicit kill/cancel behavior is straightforward. Native memory still needs an OS/container bound. | Adds a Rust build stage and one executable, but the code and dependency surface can remain very small. Resolver remains an external blocker. | **Recommended for Phase 1.** |
| C. librakaly / native shared library | Latest inspected release v0.12.7 predates the 1.17 fix. Current source may be built newer but needs its own verification. | In-process FFI/native crashes can take down Nest; Node binding ownership and ABI mistakes add risk. It materializes output in memory. | Cross-platform shared-library and Node FFI packaging are more complex than one executable. | Reject for the current architecture. |
| D. Long-running Rust decoder sidecar/service | Could use the same correct library and centralize resolver/version state. | A separate container can have strong cgroup limits and crash isolation. It adds an internal network/upload surface and request cancellation protocol. | More images, health checks, streaming protocol, deployment coordination, and operational state. | Revisit only if measured subprocess startup or multi-instance scale justifies it. |
| Pure TypeScript decoder | No current proven implementation; would duplicate subtle binary/version/token behavior. | Runs inside the application process. | Highest correctness and maintenance burden. | Reject. |

Rakaly CLI's repository contains an MIT `LICENSE.txt`; Jomini, archived
hoi4save, and librakaly are also MIT. Required copyright/license notices and a
dependency inventory must accompany any distributed helper. Those code
licenses do not resolve the separate token-data question.

## 5. Recommended architecture

### 5.1 Exact boundary and flow

1. Keep authentication, CSRF, request admission, multipart parsing, temporary
   upload ownership, extension checks, and raw upload limits unchanged.
2. Change controller pre-validation only enough to recognize `HOI4bin` as a
   supported HOI4 payload. Do not decode it on the HTTP event loop. ZIP
   metadata validation remains unchanged.
3. Hash the original uploaded bytes exactly as today. Cache, persisted result,
   ownership, and share semantics remain unchanged.
4. In the analysis Worker, refactor `readSaveText()` into:
   - a bounded `readSavePayload()` that performs today's one full read and ZIP
     verification/inflation; and
   - an async input-normalization step selected by the seven-byte header.
5. For `HOI4txt`, call the existing `decodeSaveText()` with no extra process.
6. For `HOI4bin`, spawn the project-owned helper by an absolute configured
   path with `shell:false`. Send the already validated/inflated payload on
   stdin; do not interpolate a user filename into a command. Supply the
   resolver through a fixed read-only path, not request data.
7. The helper validates `HOI4bin`, loads and validates the resolver, melts with
   `FailedResolveStrategy::Error`, enforces the supported save-version range,
   writes `HOI4txt` to stdout, and emits only stable exit classifications plus
   bounded diagnostics.
8. The Worker counts stdout bytes while streaming. It aborts and kills the
   child before the independent melted-output cap is exceeded. It requires a
   zero exit, no unknown tokens, an exact `HOI4txt` prefix, valid UTF-8 through
   the existing decoder, and current structural validation.
9. Feed the resulting string to the same internal text-analysis function used
   for plaintext. Do not expose source format in `AnalyzeResult` in Phase 1.
10. Persist and authorize the result through the current path. Always clean the
    upload and decoder resources.

### 5.2 Helper protocol

Keep the helper single-purpose:

```text
stdin:  one bounded HOI4bin payload
stdout: one bounded HOI4txt payload, only on complete success
stderr: bounded diagnostic text, never returned to the client
exit 0: success
nonzero stable classes: invalid/truncated, unknown token, unsupported version,
                        resolver unavailable/invalid, internal decoder failure
```

Do not use a shell, output path supplied by the user, dynamic library loading,
network access, or JSON representation of the save. Plain Clausewitz text is
the compatibility contract with the existing parser.

Partial stdout from a failed helper must be discarded. The public API should
map decoder failures to safe `SaveInputError` codes and must not expose paths,
token contents, Rust panic messages, or stacks.

### 5.3 Cancellation ownership

Spawning from a Worker requires explicit lifecycle work: terminating a Node
Worker does not establish that its OS child was reaped. Phase 1 must use an
async child process, keep the handle, and kill/reap it on output overflow,
decoder timeout, Worker cancellation, client/server shutdown, and any stream
error.

The main Worker service should request cancellation and wait for a bounded
acknowledgement before its current hard `worker.terminate()` fallback. The
Worker should report the decoder PID/start state so the parent can apply a
last-resort kill in the production Linux container if the Worker cannot
acknowledge. The custom helper must never spawn grandchildren. Tests must prove
there is no orphan and the analysis slot is not released until both decoder
and Worker are gone.

If this cancellation protocol proves disproportionately complex, choose the
decoder sidecar instead; do not accept orphanable subprocesses as the smaller
solution.

## 6. Security model

Binary saves are hostile input. The decoder is a new native attack surface in
addition to ZIP and text parsing.

| Threat | Required control |
| --- | --- |
| Malformed/truncated token stream | Upstream fallible APIs; catch helper panic at process boundary; nonzero exit; never accept partial output. |
| Unknown/new token | `FailedResolveStrategy::Error`; fail entire request; no production stringify/ignore mode. |
| New wire format | Explicit highest verified `save_version`; safe unsupported-version error. |
| Huge raw input | Preserve current 256 MiB upload cap and request admission. |
| ZIP bomb/forged metadata | Preserve current central/local header, CRC, actual output, and 512 MiB inflation checks before decoding. |
| Huge melt expansion | Count stdout independently and kill before the melted-output cap. Do not trust an estimate or helper declaration. |
| CPU exhaustion | Decoder and total analysis deadlines; one decode per active Worker initially; benchmark before increasing. |
| Native memory exhaustion | Separate process; production container/cgroup or per-process OS memory bound. V8 `resourceLimits` do not cover Rust. |
| Rust panic/crash | Process boundary, stable error mapping, reap child, preserve backend availability. |
| Argument/filename injection | Absolute executable and resolver paths; `spawn(..., { shell: false })`; payload on stdin; no user text in arguments. |
| Diagnostic leakage | Bound stderr; log safe class/version/digests, not save contents, filesystem paths, or raw panic stacks to users. |
| Resolver tampering | Read-only secret/mount, startup syntax/self-test, configured SHA-256, no request-selectable resolver. |
| Temporary artifacts | Prefer stdin/stdout. If a fallback scratch file is unavoidable, use the existing private directory, exclusive creation, exact ownership, and all-path cleanup. |
| Concurrency amplification | Reuse request and Worker admission. Add no independent unbounded decoder queue. |
| Supply-chain substitution | `Cargo.lock --locked`, exact Git revision/checksum, reproducible image stage, SBOM/license notices, helper digest/version at startup. |

The current backend image runs Node on Alpine and has no separate Rust runtime.
A multi-stage build can compile a musl-compatible helper and copy only that
executable into the final image. The final container should run non-root with a
read-only root filesystem/no-new-privileges where deployment permits it. At
minimum, give the backend container a memory ceiling before enabling public
binary decoding.

## 7. Resource-limit strategy

Phase 1 should preserve existing limits and introduce one new independent
output limit:

| Resource | Phase 1 policy |
| --- | --- |
| Uploaded bytes | Keep `HOI4_MAX_UPLOAD_BYTES` (256 MiB default). |
| ZIP-expanded/binary input bytes | Keep `HOI4_MAX_UNCOMPRESSED_BYTES` (512 MiB default). |
| Melted plaintext bytes | Add `HOI4_MAX_MELTED_BYTES`; initial ceiling no higher than the current 512 MiB accepted plaintext ceiling. Enforce on actual stdout bytes. |
| Decode duration | Must fit inside the existing 60-second absolute analysis deadline and leave time for text parsing. Choose the dedicated value from the benchmark below; do not invent a production percentile in Phase 0. |
| Concurrent decodes | One per active analysis Worker; current default is one per backend process. |
| Decoder memory | Explicit production container/process bound derived from measured peak RSS; V8 heap limits are not a substitute. |
| stderr | Small fixed cap (diagnostics only), with truncation. |

The current upstream melter reads binary input into a `Vec`, while Node also
holds the validated payload and collects plaintext for a parser that expects a
string. Peak memory can therefore include the uploaded/ZIP buffer, inflated
binary, Rust input copy, Rust writer buffers, Node stdout buffers, JavaScript
string, parser indexes, and `AnalyzeResult`. Binary files being smaller on disk
does not imply lower peak memory.

Before selecting decode timeout and memory values, benchmark a corpus spanning
small/median/large saves, legacy binary, HOI4 1.17 save_version 30, DLC-heavy
saves, and at least one modded save. For each run record:

- raw, ZIP-expanded, and melted byte sizes and their ratios;
- decoder wall/CPU time and max RSS;
- full Worker wall time and backend/container peak RSS;
- token count and unknown-token status;
- result size and equality against the text-path oracle;
- timeout/output-limit cleanup and slot-release latency.

Use warm and cold runs on the deployment architecture. Set the decode deadline
from the measured high percentile plus an explicit margin, while remaining
below the total analysis deadline. Do not increase the 512 MiB plaintext or
1 GiB Worker defaults merely to make a fixture pass without a memory budget.

## 8. Testing strategy

### 8.1 Rust helper tests

- legacy binary fixed-point decoding;
- `save_version=30` eight-byte `0x000d`, including nested skip paths;
- valid resolver parsing and exact `HOI4txt` header/output;
- unknown token fails with no accepted partial output;
- empty/malformed resolver;
- truncated token/value/container and random malformed input;
- unsupported higher save version;
- broken stdout/stderr consumer;
- deterministic output for the same input;
- panic containment/fuzz targets for token streams.

Use upstream's real `1.17-new-ironman-format.hoi4` fixture only if its fixture
distribution terms are suitable for this repository. Otherwise obtain a
project-owned redistributable modern fixture; do not silently download a
fixture in unit tests.

### 8.2 Node boundary tests

- existing plaintext raw and ZIP output is byte/semantic identical and never
  starts the helper;
- valid raw and ZIP-wrapped binary input reaches the helper;
- unknown token, unsupported format, malformed/truncated input, invalid UTF-8,
  nonzero exit, signal/crash, missing executable, and invalid resolver map to
  safe errors and create no persisted result/ownership;
- actual melted stdout above its cap kills/reaps the helper;
- decoder timeout and outer Worker timeout kill/reap helper and Worker;
- stderr/output are bounded;
- concurrent requests preserve request/Worker limits and release every slot on
  all failures;
- upload, scratch (if any), and child cleanup on success, cache hit, error,
  crash, timeout, client abort, persistence error, and shutdown;
- filenames containing shell metacharacters cannot affect invocation.

### 8.3 End-to-end regressions

- current representative plaintext save and existing analyzer hashes/metrics;
- a valid modern binary save through multipart and local-path modes (where
  enabled);
- a binary save melted by the helper, then the exact melted text analyzed
  directly: deep equality of deterministic `AnalyzeResult` fields, excluding
  runtime-only timing;
- stable expected metrics from an independently checked modern binary fixture;
- cache identity remains the original input hash;
- Batch Analysis, persistence reopen, ownership isolation, Compare, Trends,
  report/export, and share behavior remain unchanged after persistence;
- no unknown-token result is ever returned as success.

Fuzzing belongs in the Rust helper CI or a scheduled job, not the ordinary Jest
suite. CI should also build the helper with `cargo build --locked`, run license
and advisory checks, and exercise the final container artifact rather than only
the development binary.

## 9. Deployment implications

1. Add a Rust builder stage to `server/Dockerfile`; copy one pinned static
   helper into the Node runtime image. Do not install a Rust toolchain in the
   runtime image.
2. Commit helper source, `Cargo.toml`, and `Cargo.lock`. Do not commit `target/`,
   downloaded release archives, token data, real saves, or melted outputs.
3. Add a disabled-by-default binary feature flag until resolver provenance and
   deployment are approved. Plaintext readiness must not depend on a missing
   resolver while the feature is disabled.
4. If enabled, require an exact read-only resolver path/digest at startup and
   run a small decoder self-test. Fail binary readiness clearly rather than
   accepting an empty resolver. Do not expose the resolver through health/API
   output.
5. Include MIT notices for Jomini/hoi4save and transitive dependencies, an SBOM,
   and the exact helper source revision. Treat token data as a separate legal
   artifact.
6. Add production memory/process limits and verify cancellation in the actual
   Docker profile. A Node Worker heap limit alone does not constrain the helper.
7. Roll out behind telemetry for safe error classes and durations only. Never
   log save contents, token mappings, or user filenames beyond existing safe
   metadata.
8. Upgrade decoder and resolver independently, always against old/new real
   fixtures and deterministic result comparisons.

No database, API result, persistence schema, frontend analysis contract, or
parser-domain change is required. The existing guided binary-recovery UI can
remain as the fallback while the feature is disabled or reports an unsupported
resolver/version.

## 10. Risks and unresolved questions

### Release blockers

1. **Token resolver provenance and rights.** Obtain a documented lawful source
   and decide whether it may be used server-side, mounted operationally, and/or
   redistributed in an image. Upstream's private use is not sufficient proof
   for this project.
2. **Modern fixture ownership.** Add a redistributable real HOI4 1.17+
   `save_version=30` fixture and known expected results. The repository has no
   real binary fixture today.
3. **Resource benchmarks.** Measure melt expansion, decoder RSS/time, and total
   pipeline memory before enabling untrusted public uploads.
4. **Process cancellation.** Prove that Worker timeout/shutdown cannot orphan a
   decoder process.

### Other risks

- A future game update may use known tokens with changed semantics, so absence
  of unknown tokens alone is not a compatibility guarantee.
- Mod tokens may be unresolved even with a current vanilla resolver. Failing
  closed is correct but means some modded binary saves will remain unsupported.
- The same upstream crate version label currently describes materially
  different published and repository source; exact revision pinning is
  mandatory.
- A helper subprocess increases peak memory because both binary and melted text
  coexist around a parser that currently requires the complete text string.
- Upstream Rakaly release artifacts can be useful validation oracles, but
  building product behavior around an opaque embedded resolver would make
  upgrades, provenance, and reproducibility weaker.

## 11. Concrete Phase 1 plan

The Phase 0B `BLOCKED` verdict means no implementation step below may start
until the provenance/permission gate in section 3.12 passes. This is a deferred
plan, not approval to add the helper or resolver.

Phase 1 should be split into independently reviewable steps:

1. **Fixture and resolver gate (no product behavior):** secure approved resolver
   provenance and a redistributable save_version 30 fixture; record digests and
   expected values. Stop if either is unavailable.
2. **Decoder helper:** add the minimal Rust executable, exact Git dependency
   revision, lockfile, stable exit classes, unknown-token failure, version gate,
   bounded diagnostics, unit tests, and fuzz target.
3. **Container packaging:** multi-stage locked build, MIT notices/SBOM, helper
   version self-test, read-only runtime resolver mount, and non-root/resource
   controls.
4. **Input boundary refactor:** separate bounded payload extraction from text
   decoding and extract the existing text-analysis body without changing its
   output. Prove plaintext byte/result parity first.
5. **Worker integration:** accept recognized binary input, stream it to the
   helper, cap actual output, validate `HOI4txt`, map safe errors, and feed the
   existing parser. Preserve original-byte hashing.
6. **Cancellation/cleanup:** add cooperative Worker cancellation, child
   kill/reap fallback, shutdown handling, and race tests before enabling the
   feature.
7. **End-to-end tests:** raw/ZIP binary, unknown/malformed/newer/oversized/
   timeout/crash/concurrency cases, plaintext regression, result equivalence,
   persistence and ownership.
8. **Benchmark and tune:** establish output, timeout, process-memory, and
   concurrency limits using the specified corpus. Keep binary support disabled
   until the final Docker artifact passes.
9. **Controlled rollout:** enable by configuration for a small environment,
   monitor only bounded operational metrics, then replace the guided rejection
   with normal analysis success for supported binary saves.

## Upstream references

- [Jomini issue #233: configurable binary token parsing / HOI4 1.17](https://github.com/rakaly/jomini/issues/233)
- [Jomini changelog (`BinaryFormat` in 0.35; consolidation in 0.36.1)](https://github.com/rakaly/jomini/blob/master/CHANGELOG.md)
- [Current consolidated HOI4 stateful format](https://github.com/rakaly/jomini/blob/e27f87b6bd245602a6f324b35838321abe46986a/crates/hoi4save/src/flavor.rs)
- [Current HOI4 modern-format tests](https://github.com/rakaly/jomini/blob/e27f87b6bd245602a6f324b35838321abe46986a/crates/hoi4save/tests/parse.rs)
- [Archived hoi4save repository and resolver warning](https://github.com/rakaly/hoi4save)
- [Current Jomini `BasicTokenResolver` source](https://github.com/rakaly/jomini/blob/master/crates/jomini/src/binary/resolver.rs)
- [Jomini binary deserialization and token-value notes](https://github.com/rakaly/jomini/blob/master/README.md)
- [Published hoi4save 0.4.0 legacy flavor source](https://docs.rs/crate/hoi4save/0.4.0/source/src/flavor.rs)
- [Rakaly CLI v0.8.19 source](https://github.com/rakaly/cli/tree/v0.8.19)
- [Rakaly CLI v0.8.19 embedded token module](https://github.com/rakaly/cli/blob/v0.8.19/src/tokens.rs)
- [Rakaly CLI v0.8.19 public-build token placeholders](https://github.com/rakaly/cli/blob/v0.8.19/build.rs)
- [Rakaly CLI v0.8.19 exact dependency lock](https://github.com/rakaly/cli/blob/v0.8.19/Cargo.lock)
- [Rakaly CLI unknown-token behavior](https://github.com/rakaly/cli/blob/v0.8.19/src/melt.rs)
- [Rakaly CLI private-token build workflow](https://github.com/rakaly/cli/blob/v0.8.19/.github/workflows/ci.yml)
- [Rakaly CLI MIT license](https://github.com/rakaly/cli/blob/v0.8.19/LICENSE.txt)
- [librakaly v0.12.7](https://github.com/rakaly/librakaly/tree/v0.12.7)
- [librakaly v0.12.7 embedded token module](https://github.com/rakaly/librakaly/blob/v0.12.7/src/tokens.rs)
- [librakaly MIT license](https://github.com/rakaly/librakaly/blob/v0.12.7/LICENSE.txt)
- [PDX Tools binary-token setup note](https://github.com/pdx-tools/pdx-tools#binary--ironman-saves)
- [Investigated third-party `hoi4-go` resolver](https://github.com/antoniszymanski/hoi4-go)
- [Paradox User Agreement](https://legal.paradoxplaza.com/eula?locale=en)
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)
