import {
  CampaignReviewService,
  suitableReviewPair,
} from './campaign-review.service';
import { projectSnapshot } from '../analyze/campaign-snapshot-projection-cache.service';
import { comparisonResult } from '../analyze/fixtures/analysis-comparison.fixture';
import type { AnalysisOwnershipService } from '../analyze/analysis-ownership.service';
import type { PersistedAnalysisResultService } from '../analyze/persisted-analysis-result.service';
import type { CampaignSnapshotProjectionCacheService } from '../analyze/campaign-snapshot-projection-cache.service';
import { abuseRoute } from '../security/abuse-protection.service';
const fingerprint = { bytes: 20, mtimeMs: 1, ctimeMs: 1 };
const a = projectSnapshot(
  'a'.repeat(64),
  comparisonResult({ game_date: '1936.1.1' }),
  {
    campaignId: '11111111-1111-4111-8111-111111111111',
    gameVersion: '1.19.2',
    playerCountryTag: 'GER',
  },
  fingerprint,
);
const b = { ...a, hash: 'b'.repeat(64), gameDate: '1936.2.1' };
describe('C1 campaign review eligibility', () => {
  test('new endpoint retains the B2 telemetry rate-limit family', () => {
    expect(
      abuseRoute({
        method: 'POST',
        path: '/api/product-events/campaign-review',
      }),
    ).toBe('telemetry');
  });
  test('requires distinct chronological snapshots in a known campaign without a known version conflict', () => {
    expect(suitableReviewPair(a, b)).toBe(true);
    for (const target of [
      { ...b, gameDate: a.gameDate },
      { ...b, hash: a.hash },
      { ...b, campaignId: null },
      { ...b, gameDate: '1936.2.30' },
      { ...b, gameVersion: '1.19.3' },
    ])
      expect(suitableReviewPair(a, target)).toBe(false);
    expect(suitableReviewPair(a, { ...b, gameVersion: null })).toBe(true);
  });
  const setup = () => {
    const ownership = { hasAllOwnership: jest.fn().mockResolvedValue(true) };
    const results = { fingerprint: jest.fn().mockResolvedValue(fingerprint) };
    const projections = {
      ensure: jest
        .fn()
        .mockImplementation((hash: string) =>
          Promise.resolve(hash === a.hash ? a : b),
        ),
    };
    return {
      ownership,
      results,
      projections,
      service: new CampaignReviewService(
        ownership as unknown as AnalysisOwnershipService,
        results as unknown as PersistedAnalysisResultService,
        projections as unknown as CampaignSnapshotProjectionCacheService,
      ),
    };
  };
  test('rejects foreign references before artifact reads', async () => {
    const s = setup();
    s.ownership.hasAllOwnership.mockResolvedValue(false);
    expect(await s.service.eligible('user', a.hash, b.hash)).toBe(false);
    expect(s.results.fingerprint).not.toHaveBeenCalled();
  });
  test('missing/corrupt/temporary artifacts cannot qualify', async () => {
    const s = setup();
    s.projections.ensure.mockResolvedValue(null);
    expect(await s.service.eligible('user', a.hash, b.hash)).toBe(false);
    s.results.fingerprint.mockResolvedValue(null);
    expect(await s.service.eligible('user', a.hash, b.hash)).toBe(false);
  });
  test('reauthorizes and checks fingerprints after loading', async () => {
    const s = setup();
    expect(await s.service.eligible('user', a.hash, b.hash)).toBe(true);
    s.ownership.hasAllOwnership
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(await s.service.eligible('user', a.hash, b.hash)).toBe(false);
    s.ownership.hasAllOwnership.mockResolvedValue(true);
    s.results.fingerprint
      .mockResolvedValueOnce(fingerprint)
      .mockResolvedValueOnce(fingerprint)
      .mockResolvedValueOnce({ ...fingerprint, mtimeMs: 2 });
    expect(await s.service.eligible('user', a.hash, b.hash)).toBe(false);
  });
});
