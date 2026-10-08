import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { databaseConfig } from '../database/database.config';
import { PersistedAnalysisResultService } from '../analyze/persisted-analysis-result.service';
import { CampaignSnapshotProjectionCacheService } from '../analyze/campaign-snapshot-projection-cache.service';
import { sameFingerprint } from '../analyze/owned-analysis-history';
import {
  suitableReviewPair,
  type ReviewSnapshotIdentity,
} from './campaign-review.service';
import {
  CAMPAIGN_REVIEW_KINDS,
  type CampaignReviewKind,
} from './product-events.types';
import type { DatabaseExecutor } from '../database/database.service';
import { intelligenceDate } from '../analyze/intelligence/campaign-intelligence.service';
import { compareDates } from '../analyze/campaign-trends.service';

type Observation = 'observed' | 'not_observed' | 'unavailable' | 'incomplete';
interface Participant {
  participantId: string;
  role: 'tester' | 'developer' | 'demo' | 'automated';
  invitedAt: string;
  registration: 'registered' | 'unregistered' | 'unknown';
  userId: string | null;
  usefulnessConfirmed: boolean | null;
  /** Explicit study records, not an inference from timestamps. UTC dates. */
  unpromptedReturnDates: string[];
}
export interface AlphaCohort {
  startedAt: string;
  telemetryVerifiedSince: string | null;
  participants: Participant[];
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const instant = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
export const utcDay = (value: string): string =>
  new Date(value).toISOString().slice(0, 10);
export function calendarOffset(first: string, later: string): number {
  return (
    (Date.parse(`${utcDay(later)}T00:00:00Z`) -
      Date.parse(`${utcDay(first)}T00:00:00Z`)) /
    86400000
  );
}
export function returnObservation(
  first: string | null,
  dates: readonly string[],
  day: number,
  asOf: string,
  coverage: boolean,
): Observation {
  if (!first || !coverage) return 'unavailable';
  if (calendarOffset(first, asOf) <= day) return 'incomplete';
  if (dates.some((date) => calendarOffset(first, date) === day))
    return 'observed';
  // The entire target calendar day must have elapsed before absence is reported.
  return 'not_observed';
}
export function meaningfulReturnCandidate(
  first: {
    at: Date;
    base: ReviewSnapshotIdentity;
    target: ReviewSnapshotIdentity;
  },
  later: {
    at: Date;
    target: ReviewSnapshotIdentity;
    acquiredAt: Date | null;
  },
  previouslyAcquired: ReadonlySet<string>,
): boolean {
  const start = intelligenceDate(first.target.gameDate),
    end = intelligenceDate(later.target.gameDate);
  return (
    calendarOffset(first.at.toISOString(), later.at.toISOString()) > 0 &&
    !!first.target.campaignId &&
    first.target.campaignId === later.target.campaignId &&
    later.target.hash !== first.base.hash &&
    later.target.hash !== first.target.hash &&
    !!later.acquiredAt &&
    later.acquiredAt > first.at &&
    later.acquiredAt <= later.at &&
    !previouslyAcquired.has(later.target.hash) &&
    !!start &&
    !!end &&
    compareDates(start, end) < 0
  );
}
export function parseCohort(value: unknown): AlphaCohort {
  if (!value || typeof value !== 'object') throw new Error('Invalid cohort');
  const c = value as AlphaCohort;
  if (
    !instant(c.startedAt) ||
    !(c.telemetryVerifiedSince === null || instant(c.telemetryVerifiedSince)) ||
    !Array.isArray(c.participants) ||
    c.participants.length > 30
  )
    throw new Error('Invalid cohort');
  const ids = new Set<string>(),
    users = new Set<string>();
  for (const p of c.participants) {
    if (
      !p ||
      !/^[a-zA-Z0-9_-]{1,32}$/.test(p.participantId) ||
      ids.has(p.participantId) ||
      !['tester', 'developer', 'demo', 'automated'].includes(p.role) ||
      !instant(p.invitedAt) ||
      Date.parse(p.invitedAt) < Date.parse(c.startedAt) ||
      !['registered', 'unregistered', 'unknown'].includes(p.registration) ||
      !(
        p.usefulnessConfirmed === null ||
        typeof p.usefulnessConfirmed === 'boolean'
      ) ||
      !Array.isArray(p.unpromptedReturnDates) ||
      p.unpromptedReturnDates.length > 31 ||
      !p.unpromptedReturnDates.every(
        (d) =>
          typeof d === 'string' &&
          /^\d{4}-\d\d-\d\d$/.test(d) &&
          instant(`${d}T00:00:00Z`) &&
          utcDay(`${d}T00:00:00Z`) === d,
      )
    )
      throw new Error('Invalid participant');
    ids.add(p.participantId);
    if (p.registration === 'registered') {
      if (
        !p.userId ||
        !UUID.test(p.userId) ||
        users.has(p.userId.toLowerCase())
      )
        throw new Error('Duplicate/invalid cohort account');
      users.add(p.userId.toLowerCase());
    } else if (p.userId !== null)
      throw new Error('Unmapped participant must not claim an account');
  }
  if (c.participants.filter((p) => p.role === 'tester').length !== 20)
    throw new Error('Exactly 20 independently verified testers required');
  return c;
}
interface OwnerRow {
  user_id: string;
  analysis_hash: string;
  durable_acquired_at: Date | null;
}
interface EventRow {
  user_id: string;
  event_name: string;
  occurred_at: Date;
  properties: Record<string, unknown>;
  target_hash: string | null;
  base_hash: string | null;
}
interface UserRow {
  id: string;
  created_at: Date;
}

/** Read-only operator report. No AppModule/Recent startup, writes, reconciliation,
 * backfill, filenames, emails, UUIDs, hashes or campaign IDs in the output. */
export async function buildAlphaReport(
  database: DatabaseExecutor,
  results: PersistedAnalysisResultService,
  projections: CampaignSnapshotProjectionCacheService,
  cohort: AlphaCohort,
  asOf: string,
) {
  parseCohort(cohort);
  if (!instant(asOf) || Date.parse(asOf) < Date.parse(cohort.startedAt))
    throw new Error('Invalid observation end');
  const testers = cohort.participants.filter((p) => p.role === 'tester');
  if (testers.some((p) => Date.parse(p.invitedAt) > Date.parse(asOf)))
    throw new Error('Future invitation');
  const userIds = testers.flatMap((p) => (p.userId ? [p.userId] : []));
  const users = (
    await database.query<UserRow & Record<string, unknown>>(
      'SELECT id, created_at FROM users WHERE id=ANY($1::uuid[]) AND NOT is_admin AND created_at <= $2',
      [userIds, asOf],
    )
  ).rows;
  const owners = (
    await database.query<OwnerRow & Record<string, unknown>>(
      'SELECT user_id, analysis_hash, durable_acquired_at FROM analysis_ownership WHERE user_id=ANY($1::uuid[]) LIMIT 20001',
      [userIds],
    )
  ).rows;
  const events = (
    await database.query<EventRow & Record<string, unknown>>(
      `SELECT e.user_id,e.event_name,e.occurred_at,e.properties,a.content_hash AS target_hash,b.content_hash AS base_hash
     FROM product_events e LEFT JOIN analyses a ON a.id=e.analysis_id
     LEFT JOIN analyses b ON b.id::text=e.properties->>'baseAnalysisId'
     WHERE e.user_id=ANY($1::uuid[]) AND e.occurred_at >= $2 AND e.occurred_at <= $3
     ORDER BY e.occurred_at,e.id LIMIT 100001`,
      [userIds, cohort.startedAt, asOf],
    )
  ).rows;
  if (events.length > 100000 || owners.length > 20000)
    throw new Error(
      'Cohort report scope too large; narrow the observation window',
    );
  const loaded = new Map<string, ReviewSnapshotIdentity>();
  const before = new Map<
    string,
    NonNullable<
      Awaited<ReturnType<PersistedAnalysisResultService['fingerprint']>>
    >
  >();
  for (const hash of new Set(owners.map((o) => o.analysis_hash))) {
    const fingerprint = await results.fingerprint(hash);
    if (!fingerprint) continue;
    before.set(hash, fingerprint);
    const projection = await projections.ensure(hash, fingerprint);
    if (projection)
      loaded.set(hash, {
        hash: projection.hash,
        gameDate: projection.gameDate,
        campaignId: projection.campaignId,
        gameVersion: projection.gameVersion,
      });
  }
  const coverage =
    cohort.telemetryVerifiedSince !== null &&
    Date.parse(cohort.telemetryVerifiedSince) <= Date.parse(cohort.startedAt) &&
    Date.parse(asOf) - Date.parse(cohort.startedAt) < 90 * 86400000;
  const rows = testers.map((p) => {
    const user = users.find(
      (u) => u.id.toLowerCase() === p.userId?.toLowerCase(),
    );
    const owned = owners.filter((o) => o.user_id === user?.id);
    const available = owned.flatMap((o) => {
      const s = loaded.get(o.analysis_hash);
      return s ? [{ ...o, s }] : [];
    });
    const acquisitions = available.filter(
      (o) =>
        o.durable_acquired_at &&
        o.durable_acquired_at.getTime() >=
          Math.max(
            Date.parse(cohort.startedAt),
            Date.parse(p.invitedAt),
            user?.created_at.getTime() ?? Infinity,
          ) &&
        o.durable_acquired_at.getTime() <= Date.parse(asOf),
    );
    const readyCampaigns = new Set<string>();
    for (const a of available) {
      if (!a.s.campaignId || readyCampaigns.has(a.s.campaignId)) continue;
      for (const b of available)
        if (suitableReviewPair(a.s, b.s)) readyCampaigns.add(a.s.campaignId);
    }
    const observed = events.filter(
      (e) =>
        e.user_id === user?.id &&
        e.occurred_at.getTime() >=
          Math.max(
            Date.parse(p.invitedAt),
            user?.created_at.getTime() ?? Infinity,
          ),
    );
    const persisted = observed.filter(
      (e) => e.event_name === 'analysis_persisted',
    );
    // A server-confirmed historical event proves acquisition at that time, not
    // that an artifact deleted since then is still available now.
    const firstDurable =
      [
        ...acquisitions.map((o) => o.durable_acquired_at!.toISOString()),
        ...persisted.map((e) => e.occurred_at.toISOString()),
      ].sort()[0] ?? null;
    const reviews = observed.filter(
      (e) =>
        e.event_name === 'campaign_review_opened' &&
        CAMPAIGN_REVIEW_KINDS.includes(
          e.properties.viewKind as CampaignReviewKind,
        ),
    );
    const validated = reviews.flatMap((e) => {
      const a = available.find((o) => o.analysis_hash === e.base_hash),
        b = available.find((o) => o.analysis_hash === e.target_hash);
      return a && b && suitableReviewPair(a.s, b.s) ? [{ e, a, b }] : [];
    });
    const firstReview = validated[0];
    const previous = new Set(
      persisted
        .filter(
          (e) => firstReview && e.occurred_at <= firstReview.e.occurred_at,
        )
        .flatMap((e) => (e.target_hash ? [e.target_hash] : [])),
    );
    const meaningful = validated.filter(
      ({ e, b }) =>
        firstReview &&
        meaningfulReturnCandidate(
          {
            at: firstReview.e.occurred_at,
            base: firstReview.a.s,
            target: firstReview.b.s,
          },
          { at: e.occurred_at, target: b.s, acquiredAt: b.durable_acquired_at },
          previous,
        ),
    );
    const meaningfulDates = meaningful.map((r) =>
      r.e.occurred_at.toISOString(),
    );
    const first = firstReview?.e.occurred_at.toISOString() ?? null;
    const completeCoverage = coverage && reviews.length === validated.length;
    const reviewUsage = Object.fromEntries(
      CAMPAIGN_REVIEW_KINDS.map((k) => [
        k,
        validated.filter((r) => r.e.properties.viewKind === k).length,
      ]),
    );
    return {
      participantId: p.participantId,
      registration: user
        ? 'verified'
        : p.registration === 'unregistered'
          ? 'operator_confirmed_unregistered'
          : 'unavailable',
      firstDurableAt: firstDurable,
      durableStatus: firstDurable
        ? 'observed'
        : (owned.length && available.length !== owned.length) ||
            available.some((o) => o.durable_acquired_at === null)
          ? 'unavailable'
          : user && coverage
            ? 'not_observed'
            : 'unavailable',
      retainedReadableSnapshots: user ? available.length : null,
      unavailableArtifacts: user ? owned.length - available.length : null,
      readyCampaigns: user ? readyCampaigns.size : null,
      firstReviewAt: first,
      firstReviewStatus: first
        ? 'observed'
        : completeCoverage && user
          ? 'not_observed'
          : 'unavailable',
      registrationToDurableSeconds:
        firstDurable && user
          ? (Date.parse(firstDurable) - user.created_at.getTime()) / 1000
          : null,
      registrationToReviewSeconds:
        first && user
          ? (Date.parse(first) - user.created_at.getTime()) / 1000
          : null,
      usefulnessConfirmed: p.usefulnessConfirmed,
      confirmedUsefulActivation:
        !!firstDurable && !!first && p.usefulnessConfirmed === true,
      laterDayReturn: first
        ? observed.some(
            (e) => utcDay(e.occurred_at.toISOString()) > utcDay(first),
          )
          ? 'observed'
          : completeCoverage
            ? 'not_observed'
            : 'unavailable'
        : 'unavailable',
      meaningfulReturn: meaningful.length
        ? 'observed'
        : completeCoverage && first
          ? 'not_observed'
          : 'unavailable',
      meaningfulIndependentReturn: meaningfulDates.some((d) =>
        p.unpromptedReturnDates.includes(utcDay(d)),
      ),
      d1Meaningful: returnObservation(
        first,
        meaningfulDates,
        1,
        asOf,
        completeCoverage,
      ),
      d7Meaningful: returnObservation(
        first,
        meaningfulDates,
        7,
        asOf,
        completeCoverage,
      ),
      reviewUsage: user && completeCoverage ? reviewUsage : null,
      unverifiableReviewEvents: reviews.length - validated.length,
      uploadRejections:
        coverage && user
          ? observed.filter((e) => e.event_name === 'analysis_upload_rejected')
              .length
          : null,
      persistenceFailures:
        coverage &&
        user &&
        !observed.some(
          (e) =>
            e.event_name === 'analysis_completed' &&
            !['saved', 'temporary'].includes(
              String(e.properties.persistenceOutcome),
            ),
        )
          ? observed.filter(
              (e) =>
                (e.event_name === 'analysis_completed' &&
                  e.properties.persistenceOutcome === 'temporary') ||
                (e.event_name === 'analysis_failed' &&
                  e.properties.failureStage === 'persistence'),
            ).length
          : null,
      persistenceOutcomesUnknown: observed.filter(
        (e) =>
          e.event_name === 'analysis_completed' &&
          !['saved', 'temporary'].includes(
            String(e.properties.persistenceOutcome),
          ),
      ).length,
    };
  });
  for (const [hash, fingerprint] of before) {
    const after = await results.fingerprint(hash);
    if (!after || !sameFingerprint(fingerprint, after))
      throw new Error(
        'Artifact state changed during report; retry against a stable copy',
      );
  }
  const retention = (key: 'd1Meaningful' | 'd7Meaningful') => ({
    observed: rows.filter((r) => r[key] === 'observed').length,
    eligible: rows.filter((r) => ['observed', 'not_observed'].includes(r[key]))
      .length,
    incomplete: rows.filter((r) => r[key] === 'incomplete').length,
    unavailable: rows.filter((r) => r[key] === 'unavailable').length,
  });
  return {
    asOf,
    timezone: 'UTC',
    invited: 20,
    excluded: cohort.participants.length - 20,
    telemetryCoverageVerified: coverage,
    registered: rows.filter((r) => r.registration === 'verified').length,
    registrationUnavailable: rows.filter(
      (r) => r.registration === 'unavailable',
    ).length,
    durableActivated: rows.filter((r) => r.durableStatus === 'observed').length,
    durableUnavailable: rows.filter((r) => r.durableStatus === 'unavailable')
      .length,
    campaignReady: rows.filter((r) => (r.readyCampaigns ?? 0) > 0).length,
    campaignReadinessUnavailable: rows.filter((r) => r.readyCampaigns === null)
      .length,
    reviewed: rows.filter((r) => r.firstReviewStatus === 'observed').length,
    reviewUnavailable: rows.filter((r) => r.firstReviewStatus === 'unavailable')
      .length,
    confirmedUsefulActivations: rows.filter((r) => r.confirmedUsefulActivation)
      .length,
    meaningfulReturnsObserved: rows.filter(
      (r) => r.meaningfulReturn === 'observed',
    ).length,
    meaningfulIndependentReturnsConfirmed: rows.filter(
      (r) => r.meaningfulIndependentReturn,
    ).length,
    d1: retention('d1Meaningful'),
    d7: retention('d7Meaningful'),
    participants: rows,
  };
}

async function main() {
  // This standalone operator process emits JSON only. Unreadable artifacts are
  // represented in report status/counts; generic command failure goes to stderr.
  Logger.overrideLogger(false);
  const [manifest, flag, asOf, ...extra] = process.argv.slice(2);
  if (!manifest || flag !== '--as-of' || !instant(asOf) || extra.length)
    throw new Error(
      'Usage: alpha-cohort-report <private-manifest.json> --as-of <ISO>',
    );
  if (Date.parse(asOf) > Date.now())
    throw new Error('Observation end cannot be in the future');
  const text = await readFile(manifest, 'utf8');
  if (Buffer.byteLength(text) > 65536) throw new Error('Cohort file too large');
  const cohort = parseCohort(JSON.parse(text));
  const config = databaseConfig();
  if (!config.enabled) throw new Error('Database required');
  const pool = new Pool({
    connectionString: config.connectionString,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const results = new PersistedAnalysisResultService();
    const output = await buildAlphaReport(
      client,
      results,
      new CampaignSnapshotProjectionCacheService(results),
      cohort,
      asOf,
    );
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    client?.release();
    await pool.end();
  }
}
if (require.main === module)
  void main().catch(() => {
    process.stderr.write(
      'Cohort report unavailable. Check private manifest, migrations, read-only database access and stable artifact snapshot.\n',
    );
    process.exitCode = 1;
  });
