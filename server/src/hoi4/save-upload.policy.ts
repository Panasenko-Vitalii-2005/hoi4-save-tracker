import { basename, win32 } from 'node:path';

const MiB = 1024 * 1024;

export interface SaveUploadPolicy {
  maxUploadBytes: number;
  maxUncompressedBytes: number;
  analysisTimeoutMs: number;
  uploadTimeoutMs: number;
  maxConcurrentRequests: number;
  maxWorkerHeapMb: number;
}

// Byte/timer settings must also fit Node's signed 32-bit timer/runtime limits.
function positive(
  value: string | undefined,
  fallback: number,
  max = 0x7fffffff,
) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= max
    ? number
    : fallback;
}

export function saveUploadPolicy(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<SaveUploadPolicy> {
  return {
    maxUploadBytes: positive(env.HOI4_MAX_UPLOAD_BYTES, 256 * MiB),
    maxUncompressedBytes: positive(env.HOI4_MAX_UNCOMPRESSED_BYTES, 512 * MiB),
    analysisTimeoutMs: positive(env.HOI4_ANALYSIS_TIMEOUT_MS, 60_000),
    uploadTimeoutMs: positive(env.HOI4_UPLOAD_TIMEOUT_MS, 120_000),
    maxConcurrentRequests: positive(env.HOI4_ANALYSIS_REQUESTS, 2, 32),
    maxWorkerHeapMb: positive(env.HOI4_ANALYSIS_HEAP_MB, 1024, 8192),
  };
}

export const MAX_ZIP_ENTRIES = 8;
export const MAX_ZIP_DIRECTORY_BYTES = 256 * 1024;
export const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const UPLOAD_STALE_MS = 6 * 60 * 60 * 1000;
export const MAX_STARTUP_CLEANUP_ENTRIES = 1000;

export function sanitizeSaveFileName(name: string): string {
  // Both separator conventions, regardless of the server's operating system.
  const leaf = win32.basename(basename(name));
  const safe = Array.from(leaf)
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return (
        code >= 32 &&
        !(code >= 127 && code <= 159) &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069)
      );
    })
    .join('')
    .trim();
  // Preserve the extension when shortening presentation metadata.
  return safe.length > 240 ? `${safe.slice(0, 230)}${safe.slice(-10)}` : safe;
}
