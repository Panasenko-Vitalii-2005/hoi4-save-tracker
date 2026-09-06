import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AnalysisOwnership,
  AnalysisOwnershipService,
} from './analysis-ownership.service';
import { comparisonResult } from './fixtures/analysis-comparison.fixture';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { SharedAnalysesService } from './shared-analyses.service';
import { UserAnalysesService } from './user-analyses.service';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const A1 = digest('a-only');
const B1 = digest('b-only');
const H = digest('shared');
const L = digest('legacy');
const X = digest('owned-without-recent-metadata');
const CAMPAIGN = '0731c3c7-035e-46b1-b07b-6c35b27e8dc2';

class MemoryOwnership {
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

describe('UserAnalysesService ownership isolation', () => {
  let directory: string;
  let ownership: MemoryOwnership;
  let results: PersistedAnalysisResultService;
  let recent: RecentAnalysesService;
  let shares: SharedAnalysesService;
  let service: UserAnalysesService;
  const environment = {
    recent: process.env.HOI4_RECENT_ANALYSES_FILE,
    results: process.env.HOI4_ANALYSIS_RESULTS_DIR,
    shares: process.env.HOI4_SHARED_ANALYSES_FILE,
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hoi4-user-analyses-'));
    process.env.HOI4_RECENT_ANALYSES_FILE = join(directory, 'recent.json');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    process.env.HOI4_SHARED_ANALYSES_FILE = join(directory, 'shares.json');
    ownership = new MemoryOwnership();
    results = new PersistedAnalysisResultService();
    shares = new SharedAnalysesService(results);
    recent = new RecentAnalysesService(results, shares);
    service = new UserAnalysesService(
      ownership as unknown as AnalysisOwnershipService,
      recent,
      results,
      shares,
    );
    const result = comparisonResult();
    for (const [hash, name] of [
      [A1, 'global-a.hoi4'],
      [B1, 'global-b.hoi4'],
      [H, 'global-shared.hoi4'],
      [L, 'legacy-private.hoi4'],
    ] as const)
      await recent.record({ hash, fileName: name, fileSizeBytes: 10 }, result, {
        campaignId: CAMPAIGN,
        gameVersion: '1.0',
      });
    ownership.own(A, A1, 'a-private.hoi4');
    ownership.own(A, H, 'a-shared-name.hoi4');
    ownership.own(B, B1, 'b-private.hoi4');
    ownership.own(B, H, 'b-shared-name.hoi4');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('HOI4_RECENT_ANALYSES_FILE', environment.recent);
    restore('HOI4_ANALYSIS_RESULTS_DIR', environment.results);
    restore('HOI4_SHARED_ANALYSES_FILE', environment.shares);
  });

  test('Recent and reopen expose A1/H to A and B1/H to B without leaking global filenames or legacy data', async () => {
    const a = await service.list(A);
    const b = await service.list(B);

    expect(a.map((item) => item.hash).sort()).toEqual([A1, H].sort());
    expect(b.map((item) => item.hash).sort()).toEqual([B1, H].sort());
    expect(a.find((item) => item.hash === H)?.fileName).toBe(
      'a-shared-name.hoi4',
    );
    expect(b.find((item) => item.hash === H)?.fileName).toBe(
      'b-shared-name.hoi4',
    );
    expect(JSON.stringify(a)).not.toMatch(/global-b|legacy-private/);
    await expect(service.getResult(A, A1)).resolves.not.toBeNull();
    await expect(service.getResult(A, H)).resolves.not.toBeNull();
    await expect(service.getResult(A, B1)).resolves.toBeNull();
    await expect(service.getResult(A, L)).resolves.toBeNull();
  });

  test('storage counts and bytes are scoped to logical owned artifacts', async () => {
    const inventory = await results.storageStatus();
    const bytes = new Map(
      inventory.files.map((file) => [file.hash, file.bytes]),
    );
    const status = await service.storageStatus(A);

    expect(status.recentAnalysisCount).toBe(2);
    expect(status.persistedAnalysisCount).toBe(2);
    expect(status.persistedResultBytes).toBe(
      (bytes.get(A1) ?? 0) + (bytes.get(H) ?? 0),
    );
    expect(status.knownCampaignCount).toBe(1);
    expect(status.campaigns[0].analysisCount).toBe(2);
  });

  test('storage and bulk cleanup include owned artifacts missing global Recent metadata', async () => {
    await expect(
      results.save(X, comparisonResult(), [
        ...[A1, B1, H, L].map((hash) => ({
          hash,
          pinned: false,
          analyzedAt: '2026-01-01T00:00:00.000Z',
        })),
        { hash: X, pinned: false, analyzedAt: '2026-01-01T00:00:00.000Z' },
      ]),
    ).resolves.toBe(true);
    await expect(shares.create(X)).resolves.not.toBeNull();
    ownership.own(A, X, 'detached.hoi4');

    expect((await service.list(A)).some((item) => item.hash === X)).toBe(false);
    const status = await service.storageStatus(A);
    expect(status.persistedAnalysisCount).toBe(3);
    expect(status.cleanupEligibleCount).toBe(3);
    expect(status.unknownCampaignAnalysisCount).toBe(1);
    await expect(service.clear(A)).resolves.toEqual(
      expect.arrayContaining([A1, H, X]),
    );
    await expect(service.getResult(A, X)).resolves.toBeNull();
  });

  test('pin state is per user and foreign hashes cannot be pinned', async () => {
    await expect(service.setPinned(A, H, true)).resolves.toBe(true);
    await expect(service.setPinned(A, B1, true)).resolves.toBe(false);

    expect(
      (await service.list(A)).find((item) => item.hash === H)?.pinned,
    ).toBe(true);
    expect(
      (await service.list(B)).find((item) => item.hash === H)?.pinned,
    ).toBe(false);
  });

  test('deleting shared ownership leaves the other owner and physical artifact intact', async () => {
    const share = await shares.create(H);
    await expect(service.delete(A, H)).resolves.toBe(true);
    await expect(service.delete(A, H)).resolves.toBe(false);

    await expect(service.getResult(A, H)).resolves.toBeNull();
    await expect(service.getResult(B, H)).resolves.not.toBeNull();
    await expect(results.exists(H)).resolves.toBe(true);
    await expect(shares.getResult(share!.id)).resolves.not.toBeNull();
  });

  test('removing the final owner leaves physical lifecycle to global retention', async () => {
    await expect(service.delete(A, A1)).resolves.toBe(true);
    await expect(service.getResult(A, A1)).resolves.toBeNull();
    await expect(results.exists(A1)).resolves.toBe(true);
  });

  test('campaign and unpinned cleanup affect only the requesting user and protect their pins', async () => {
    await service.setPinned(A, H, true);
    await expect(
      service.deleteCampaign(A, CAMPAIGN, false),
    ).rejects.toMatchObject({ pinnedCount: 1 });
    await expect(service.deleteUnpinned(A)).resolves.toEqual([A1]);
    expect((await service.list(A)).map((item) => item.hash)).toEqual([H]);
    expect((await service.list(B)).map((item) => item.hash).sort()).toEqual(
      [B1, H].sort(),
    );
    await expect(service.deleteCampaign(A, CAMPAIGN, true)).resolves.toEqual([
      H,
    ]);
    await expect(service.getResult(B, H)).resolves.not.toBeNull();
  });

  test('ownership database failure fails closed before private result access', async () => {
    jest
      .spyOn(ownership, 'hasOwnership')
      .mockRejectedValueOnce(new Error('database unavailable'));
    const get = jest.spyOn(results, 'get');

    await expect(service.getResult(A, A1)).rejects.toThrow(
      'database unavailable',
    );
    expect(get).not.toHaveBeenCalled();
  });
});
