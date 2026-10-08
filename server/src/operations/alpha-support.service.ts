import type { DatabaseService } from '../database/database.service';
import type { SharedAnalysesService } from '../analyze/shared-analyses.service';

export type AccountAction = 'revoke-sessions' | 'disable' | 'delete-account';
export interface OperatorConfirmation {
  apply: boolean;
  offlineConfirmed: boolean;
  confirmUser: string;
  verifiedCase: string;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function accountId(value: string): string {
  if (!UUID.test(value))
    throw new Error('Use a verified account UUID, not an email');
  return value.toLowerCase();
}

/** Offline operator-only tool, deliberately NOT an HTTP/Nest provider. Flags are
 * safeguards, not identity proof: verification is performed through the cohort's
 * previously established channel. Stop all application writers before applying. */
export class AlphaSupportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly shares: SharedAnalysesService,
  ) {}

  async preview(target: string) {
    const id = accountId(target);
    const result = await this.database.query<{
      disabled: boolean;
      is_admin: boolean;
      sessions: string;
      owned: string;
      events: string;
    }>(
      `SELECT disabled, is_admin,
      (SELECT count(*) FROM sessions WHERE user_id=$1) AS sessions,
      (SELECT count(*) FROM analysis_ownership WHERE user_id=$1) AS owned,
      (SELECT count(*) FROM product_events WHERE user_id=$1) AS events
      FROM users WHERE id=$1`,
      [id],
    );
    if (!result.rows[0]) return { found: false };
    const protection = await this.shares.protection();
    const hashes = await this.ownedHashes(id);
    const owned = new Set(hashes);
    return {
      found: true,
      disabled: result.rows[0].disabled,
      admin: result.rows[0].is_admin,
      sessions: Number(result.rows[0].sessions),
      ownedAnalyses: Number(result.rows[0].owned),
      accountLinkedEvents: Number(result.rows[0].events),
      globalLinksToRevoke: protection.references.filter((entry) =>
        owned.has(entry.hash),
      ).length,
      shareStoreReliable: protection.reliable,
    };
  }

  async apply(
    action: AccountAction,
    target: string,
    confirmation: OperatorConfirmation,
  ) {
    const id = accountId(target);
    if (
      !['revoke-sessions', 'disable', 'delete-account'].includes(action) ||
      !confirmation.apply ||
      !confirmation.offlineConfirmed ||
      accountId(confirmation.confirmUser) !== id ||
      !/^[A-Za-z0-9_-]{3,80}$/.test(confirmation.verifiedCase)
    )
      throw new Error(
        'Explicit offline, verified-case and matching UUID confirmation required',
      );

    // Disable + revoke first. If later link storage fails, the account stays
    // disabled, but ownership and events remain for safe retry/operator repair.
    const stopped = await this.database.transaction(async (client) => {
      await client.query("SET LOCAL statement_timeout = '10s'");
      const user = await client.query<{ is_admin: boolean }>(
        'SELECT is_admin FROM users WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!user.rows[0]) return { found: false, revokedSessions: 0 };
      if (user.rows[0].is_admin)
        throw new Error(
          'This cohort tool does not mutate administrator accounts',
        );
      if (action !== 'revoke-sessions')
        await client.query(
          'UPDATE users SET disabled=true, updated_at=now() WHERE id=$1',
          [id],
        );
      const revoked = await client.query(
        'DELETE FROM sessions WHERE user_id=$1',
        [id],
      );
      return { found: true, revokedSessions: revoked.rowCount ?? 0 };
    });
    if (!stopped.found || action !== 'delete-account')
      return { ...stopped, action };

    return this.shares.revokeForRemoval(
      () => this.ownedHashes(id),
      async (hashes) =>
        this.database.transaction(async (client) => {
          await client.query("SET LOCAL statement_timeout = '10s'");
          // Unlike ON DELETE SET NULL, explicitly remove these account-linked rows.
          const events = await client.query(
            'DELETE FROM product_events WHERE user_id=$1',
            [id],
          );
          const removed = await client.query(
            'DELETE FROM users WHERE id=$1 AND NOT is_admin',
            [id],
          );
          if (removed.rowCount !== 1)
            throw new Error('Account changed; deletion not completed');
          return {
            ...stopped,
            action,
            removedOwnerships: hashes.length,
            removedAccountLinkedEvents: events.rowCount ?? 0,
            physicalArtifactsErased: false,
            backupRecordsErased: false,
          };
        }),
    );
  }

  private async ownedHashes(id: string): Promise<string[]> {
    const result = await this.database.query<{ analysis_hash: string }>(
      'SELECT analysis_hash FROM analysis_ownership WHERE user_id=$1 ORDER BY analysis_hash',
      [id],
    );
    return result.rows.map((row) => row.analysis_hash);
  }
}

export const RAW_EVENT_RETENTION_DAYS = 90;
export const RETENTION_BATCH_SIZE = 1000;
export const RETENTION_MAX_BATCHES = 20;

/** Explicit bounded operational purge, not a scheduler or artifact cleanup. */
export async function purgeOldProductEvents(database: DatabaseService) {
  const cutoff = (
    await database.query<{ cutoff: Date }>(
      "SELECT now() - interval '90 days' AS cutoff",
    )
  ).rows[0].cutoff;
  let removed = 0;
  for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
    const count = await database.transaction(async (client) => {
      await client.query("SET LOCAL statement_timeout = '10s'");
      const deleted = await client.query(
        `DELETE FROM product_events WHERE id IN (
        SELECT id FROM product_events WHERE occurred_at < $1
        ORDER BY occurred_at, id LIMIT $2
      )`,
        [cutoff, RETENTION_BATCH_SIZE],
      );
      return deleted.rowCount ?? 0;
    });
    removed += count;
    if (count < RETENTION_BATCH_SIZE) break;
  }
  const remaining = await database.query<{ remaining: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM product_events WHERE occurred_at < $1) AS remaining',
    [cutoff],
  );
  return {
    retentionDays: RAW_EVENT_RETENTION_DAYS,
    removed,
    backlogRemaining: remaining.rows[0].remaining,
  };
}
