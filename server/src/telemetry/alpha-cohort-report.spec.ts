import {
  buildAlphaReport,
  parseCohort,
  returnObservation,
  calendarOffset,
  meaningfulReturnCandidate,
  type AlphaCohort,
} from './alpha-cohort-report';
import { projectSnapshot } from '../analyze/campaign-snapshot-projection-cache.service';
import { comparisonResult } from '../analyze/fixtures/analysis-comparison.fixture';
import type { DatabaseExecutor } from '../database/database.service';
import type { PersistedAnalysisResultService } from '../analyze/persisted-analysis-result.service';
import type { CampaignSnapshotProjectionCacheService } from '../analyze/campaign-snapshot-projection-cache.service';
const U = '11111111-1111-4111-8111-111111111111';
const hash = (v: string) => v.repeat(64);
export const cohortFixture = (): AlphaCohort => ({
  startedAt: '2026-10-01T00:00:00Z',
  telemetryVerifiedSince: '2026-10-01T00:00:00Z',
  participants: Array.from({ length: 20 }, (_, i) => ({
    participantId: `p${i + 1}`,
    role: 'tester',
    invitedAt: '2026-10-01T00:00:00Z',
    registration: i === 0 ? 'registered' : 'unregistered',
    userId: i === 0 ? U : null,
    usefulnessConfirmed: i === 0 ? true : null,
    unpromptedReturnDates: i === 0 ? ['2026-10-02'] : [],
  })),
});
describe('C1 deterministic cohort reporting', () => {
  test('requires 20 distinct testers and excludes developer/demo/automated mappings', () => {
    const c = cohortFixture();
    c.participants.push({
      ...c.participants[1],
      participantId: 'dev',
      role: 'developer',
    });
    expect(parseCohort(c).participants).toHaveLength(21);
    expect(() =>
      parseCohort({ ...c, participants: c.participants.slice(1) }),
    ).toThrow('20');
    c.participants[1] = {
      ...c.participants[1],
      registration: 'registered',
      userId: U,
    };
    expect(() => parseCohort(c)).toThrow('Duplicate');
  });
  test('D1/D7 use UTC calendar days, not elapsed 24-hour sessions, with complete follow-up denominators', () => {
    const first = '2026-10-01T23:59:00Z';
    expect(calendarOffset(first, '2026-10-02T00:01:00Z')).toBe(1);
    expect(
      returnObservation(
        first,
        ['2026-10-02T00:01:00Z'],
        1,
        '2026-10-02T00:02:00Z',
        true,
      ),
    ).toBe('incomplete');
    expect(returnObservation(first, [], 7, '2026-10-08T23:59:00Z', true)).toBe(
      'incomplete',
    );
    expect(returnObservation(first, [], 7, '2026-10-09T00:00:00Z', true)).toBe(
      'not_observed',
    );
    expect(returnObservation(first, [], 7, '2026-10-09T00:00:00Z', false)).toBe(
      'unavailable',
    );
  });
  test('missing coverage or an unmapped account never becomes zero failures or a negative activation claim', async () => {
    const c = cohortFixture();
    c.telemetryVerifiedSince = null;
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: U, created_at: new Date('2026-10-01T00:01:00Z') }],
      })
      .mockResolvedValue({ rows: [] });
    const report = await buildAlphaReport(
      { query },
      {} as PersistedAnalysisResultService,
      {} as CampaignSnapshotProjectionCacheService,
      c,
      '2026-10-03T00:00:00Z',
    );
    expect(report.participants[0]).toMatchObject({
      durableStatus: 'unavailable',
      firstReviewStatus: 'unavailable',
      uploadRejections: null,
      persistenceFailures: null,
      reviewUsage: null,
    });
    expect(report.participants[1]).toMatchObject({
      uploadRejections: null,
      persistenceFailures: null,
      reviewUsage: null,
    });
  });
  test('meaningful return excludes same hashes/dates, old acquisitions and other campaigns', () => {
    const fp = { bytes: 20, mtimeMs: 1, ctimeMs: 1 };
    const context = {
      campaignId: U,
      gameVersion: '1.19.2',
      playerCountryTag: 'GER',
    };
    const base = projectSnapshot(
      hash('a'),
      comparisonResult({ game_date: '1936.1.1' }),
      context,
      fp,
    );
    const target = { ...base, hash: hash('b'), gameDate: '1936.2.1' };
    const next = { ...base, hash: hash('c'), gameDate: '1936.3.1' };
    const first = { at: new Date('2026-10-01T23:59:00Z'), base, target };
    const later = {
      at: new Date('2026-10-02T00:03:00Z'),
      target: next,
      acquiredAt: new Date('2026-10-02T00:02:00Z'),
    };
    expect(meaningfulReturnCandidate(first, later, new Set())).toBe(true);
    for (const changed of [
      { ...later, target },
      { ...later, target: { ...next, gameDate: target.gameDate } },
      { ...later, target: { ...next, campaignId: 'another' } },
      { ...later, acquiredAt: null },
      { ...later, acquiredAt: new Date('2026-10-01T00:00:00Z') },
    ])
      expect(meaningfulReturnCandidate(first, changed, new Set())).toBe(false);
    expect(meaningfulReturnCandidate(first, later, new Set([next.hash]))).toBe(
      false,
    );
  });
  test('authoritative snapshots and explicit feedback define activation and newly-added campaign return; no private IDs emitted', async () => {
    const fp = { bytes: 20, mtimeMs: 1, ctimeMs: 1 };
    const context = {
      campaignId: U,
      gameVersion: '1.19.2',
      playerCountryTag: 'GER',
    };
    const snapshots = ['a', 'b', 'c'].map((k, i) =>
      projectSnapshot(
        hash(k),
        comparisonResult({ game_date: `1936.${i + 1}.1` }),
        context,
        fp,
      ),
    );
    const query = jest
      .fn((sql: string, values?: unknown[]) => {
        void sql;
        void values;
        return Promise.resolve({ rows: [] as Record<string, unknown>[] });
      })
      .mockResolvedValueOnce({
        rows: [{ id: U, created_at: new Date('2026-10-01T00:01:00Z') }],
      })
      .mockResolvedValueOnce({
        rows: snapshots.map((s, i) => ({
          user_id: U,
          analysis_hash: s.hash,
          durable_acquired_at: new Date(
            i < 2 ? '2026-10-01T00:02:00Z' : '2026-10-02T00:02:00Z',
          ),
        })),
      })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: U,
            event_name: 'campaign_review_opened',
            occurred_at: new Date('2026-10-01T00:03:00Z'),
            properties: { viewKind: 'compare' },
            base_hash: hash('a'),
            target_hash: hash('b'),
          },
          {
            user_id: U,
            event_name: 'campaign_review_opened',
            occurred_at: new Date('2026-10-02T00:03:00Z'),
            properties: { viewKind: 'intelligence' },
            base_hash: hash('a'),
            target_hash: hash('c'),
          },
          {
            user_id: U,
            event_name: 'analysis_completed',
            occurred_at: new Date('2026-10-02T00:04:00Z'),
            properties: { persistenceOutcome: 'temporary' },
            base_hash: null,
            target_hash: null,
          },
        ],
      });
    const c = cohortFixture();
    c.participants.push({
      ...c.participants[1],
      participantId: 'demo',
      role: 'demo',
      registration: 'registered',
      userId: '22222222-2222-4222-8222-222222222222',
    });
    const result = await buildAlphaReport(
      { query } as unknown as DatabaseExecutor,
      {
        fingerprint: jest.fn().mockResolvedValue(fp),
      } as unknown as PersistedAnalysisResultService,
      {
        ensure: jest
          .fn()
          .mockImplementation((h: string) =>
            Promise.resolve(snapshots.find((s) => s.hash === h)),
          ),
      } as unknown as CampaignSnapshotProjectionCacheService,
      c,
      '2026-10-03T00:00:00Z',
    );
    expect(query.mock.calls[0][1]).toEqual([[U], '2026-10-03T00:00:00Z']);
    expect(result).toMatchObject({
      invited: 20,
      excluded: 1,
      registered: 1,
      durableActivated: 1,
      campaignReady: 1,
      reviewed: 1,
      confirmedUsefulActivations: 1,
      meaningfulIndependentReturnsConfirmed: 1,
      d1: { observed: 1, eligible: 1 },
      d7: { incomplete: 1, eligible: 0 },
    });
    expect(result.participants[0]).toMatchObject({
      registrationToDurableSeconds: 60,
      registrationToReviewSeconds: 120,
      persistenceFailures: 1,
      reviewUsage: { compare: 1, trends: 0, intelligence: 1 },
    });
    expect(JSON.stringify(result)).not.toContain(U);
    expect(JSON.stringify(result)).not.toContain(hash('a'));
    expect(
      query.mock.calls.every(([sql]) =>
        String(sql).trimStart().startsWith('SELECT'),
      ),
    ).toBe(true);
  });
});
