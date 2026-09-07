export function normalizeAnalysisHash(hash: string): string | null {
  return hash.length === 64 && /^[a-fA-F0-9]{64}$/.test(hash)
    ? hash.toLowerCase()
    : null;
}
