# Save upload transport

Large browser-selected plaintext saves can be gzip-compressed **after Analyze is
pressed**, then uploaded through the existing XHR multipart `/api/analyze` route.
This is transport compression, not a new save format or analysis identity.

## Client decision

- Only a single ordinary file part, with `HOI4txt` prefix and size >= 8 MiB.
- Requires native `File.stream()` and `CompressionStream("gzip")` support.
- Use gzip only if it saves >= 10% and >= 64 KiB, with a 32 MiB compressed Blob ceiling.
- ZIP, binary, tiny or unsuitable files use the original transport. Preparation
  failure or insufficient savings also falls back **before** sending a request.
- Cancellation never falls back; a sent request is never automatically replayed.

Preparation is indeterminate, not a fake CPU percentage. Upload progress remains
actual XHR multipart bytes (including overhead), which are compressed transfer
bytes when gzip is selected. Upload completion switches to server processing.

The source is streamed; only its seven-byte prefix is buffered. One compressed
Blob is retained for the active request, not for the whole batch. Existing batch
preflight still hashes original files sequentially with Web Crypto; it completes
before compression and retains hashes, not source ArrayBuffers.

## Wire protocol and server

Append `transportEncoding=gzip` **before** `file`, keeping the original `.hoi4`
filename. Do not set whole-request `Content-Encoding` or multipart Content-Type.
No marker means the existing transport. Unknown, duplicate and late markers are
rejected; gzip is never selected by magic-byte sniffing alone.

The upload interceptor streams file -> gunzip -> original-byte counter -> owned
temporary `.hoi4`. `file.size` is the original byte count. Existing validation,
SHA-256/cache, Worker, artifacts, ownership and result DTOs are unchanged. Thus
plain and transport-gzipped copies share the original content hash.

Wire file/body limits remain independent. Restored bytes are capped by both
`HOI4_MAX_UPLOAD_BYTES` (default 256 MiB) and `HOI4_MAX_UNCOMPRESSED_BYTES`
(default 512 MiB): the effective plaintext limit is not increased. Reject before
writing an overflowing output chunk. Never trust ISIZE or Content-Length as
restored size. CRC/truncation errors fail safely.

Existing `HOI4_ANALYSIS_REQUESTS` admission (default 2) also bounds inflaters.
The upload deadline (default 120 s) covers normalization, including its final
flush. Disconnect/shutdown abort all pipeline stages even after input EOF.
Cleanup waits for writer closure before unlink/releasing admission. After staging
finishes, existing shared-analysis lifetime rules still apply.

## Deployment acceptance (not performed automatically)

Deploy the gzip-capable backend before serving the new frontend assets. Old
clients remain compatible; new gzip clients require the new backend. Do not
work around an old backend rejection by replaying an unsafe request.

Use `autosave_160_temp.hoi4` (128,152,134 bytes) through the authenticated normal
frontend-facing route. First establish the plaintext hash/result, then enable
native gzip and verify preparation, real compressed upload progress, and server
processing. Expect roughly 12.17 MB gzip; compression output is browser-dependent.
Compare `X-Analysis-Hash`, all analysis values and original metadata size; verify
cache reuse, zero leftover upload files, healthy readiness and unchanged CSRF/
unauthenticated rejection. Never compare parse_seconds from independent parses
as a new content metric. Test batch sequencing, Cancel remaining and unmount
abort; separately test unsupported-browser plaintext fallback.

Measure Analyze-to-result with browser timing plus existing opt-in request
profiling. Multipart time now includes streaming normalization; profile
`fileBytes` continues to mean original bytes. Record wire bytes from XHR/DevTools.
The earlier ~13.2 s estimate versus ~56.2 s is not a production latency guarantee.
Validate on slower client hardware and the actual Caddy/VPS route before rollout.
