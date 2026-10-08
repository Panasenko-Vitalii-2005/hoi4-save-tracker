import type { AnalysisOwnership } from '../analysis-ownership.service';
import type { OwnedHistoryMetadata } from '../owned-analysis-history';

export class MemoryOwnership {
  private readonly users = new Map<string, Map<string, AnalysisOwnership>>();

  own(userId: string, analysisHash: string, fileName: string, pinned = false) {
    const entries =
      this.users.get(userId) ?? new Map<string, AnalysisOwnership>();
    entries.set(analysisHash, {
      analysisHash,
      fileName,
      pinned,
      analyzedAt: '2026-01-01T00:00:00.000Z',
    });
    this.users.set(userId, entries);
  }

  ensureOwnership(
    userId: string,
    hash: string,
    metadata?: { fileName: string; historyMetadata?: OwnedHistoryMetadata },
  ) {
    this.own(userId, hash, metadata?.fileName ?? 'Stored analysis');
    const entry = this.users.get(userId)!.get(hash)!;
    if (metadata?.historyMetadata)
      entry.historyMetadata = metadata.historyMetadata;
    return Promise.resolve();
  }

  setHistoryMetadata(
    userId: string,
    hash: string,
    metadata: OwnedHistoryMetadata,
  ) {
    const entry = this.users.get(userId)?.get(hash);
    if (!entry) return Promise.resolve(false);
    entry.historyMetadata = metadata;
    return Promise.resolve(true);
  }

  listAllOwnedHashes() {
    return Promise.resolve(
      new Set(
        [...this.users.values()].flatMap((entries) => [...entries.keys()]),
      ),
    );
  }

  listForUser(userId: string) {
    return Promise.resolve([...(this.users.get(userId)?.values() ?? [])]);
  }

  hasOwnership(userId: string, hash: string) {
    return Promise.resolve(this.users.get(userId)?.has(hash) === true);
  }

  ownedHashes(userId: string, hashes: readonly string[]) {
    const entries = this.users.get(userId);
    return Promise.resolve(
      new Set(hashes.filter((hash) => entries?.has(hash))),
    );
  }

  hasAllOwnership(userId: string, hashes: readonly string[]) {
    const entries = this.users.get(userId);
    return Promise.resolve(hashes.every((hash) => entries?.has(hash)));
  }

  setPinned(userId: string, hash: string, pinned: boolean) {
    const entry = this.users.get(userId)?.get(hash);
    if (!entry) return Promise.resolve(false);
    entry.pinned = pinned;
    return Promise.resolve(true);
  }

  remove(userId: string, hashes: readonly string[]) {
    const entries = this.users.get(userId);
    const removed = hashes.filter((hash) => entries?.delete(hash));
    return Promise.resolve(removed);
  }

  pinnedHashes(hashes: readonly string[]) {
    return Promise.resolve(
      new Set(
        hashes.filter((hash) =>
          [...this.users.values()].some((entries) => entries.get(hash)?.pinned),
        ),
      ),
    );
  }
}
