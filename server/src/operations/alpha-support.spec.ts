import type { DatabaseService } from '../database/database.service';
import type { SharedAnalysesService } from '../analyze/shared-analyses.service';
import { parseSupportCommand } from './alpha-support';
import {
  AlphaSupportService,
  purgeOldProductEvents,
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES,
} from './alpha-support.service';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
describe('offline support safeguards', () => {
  test('only a UUID selects an account; email/allowlist knowledge is not proof', () => {
    expect(() =>
      parseSupportCommand(['preview', 'invited@example.invalid']),
    ).toThrow('UUID');
    expect(parseSupportCommand(['preview', ID])).toEqual({
      command: 'preview',
      target: ID,
    });
  });
  test.each([
    ['delete-account', ID],
    ['disable', ID, '--apply', '--offline-confirmed'],
    [
      'delete-account',
      ID,
      '--apply',
      '--offline-confirmed',
      '--confirm-user',
      OTHER,
      '--verified-case',
      'case-1',
    ],
    [
      'disable',
      ID,
      '--apply',
      '--offline-confirmed',
      '--confirm-user',
      ID,
      '--verified-case',
      'invited@example.invalid',
    ],
    ['purge-telemetry', '--apply'],
    ['purge-telemetry', '--apply', '--offline-confirmed', '--apply'],
    ['reset-password', ID],
    ['preview', ID, '--apply'],
    ['revoke-link', 'A'.repeat(22), '--apply', '--offline-confirmed'],
  ])('rejects unsafe/unsupported operator command %j', (...args) => {
    expect(() => parseSupportCommand(args)).toThrow();
  });
  test('explicit verified/offline mutation parses, with no reset/transfer capability', () => {
    expect(
      parseSupportCommand([
        'disable',
        ID,
        '--apply',
        '--offline-confirmed',
        '--confirm-user',
        ID,
        '--verified-case',
        'case-1',
      ]),
    ).toMatchObject({ command: 'disable', target: ID });
    expect(
      parseSupportCommand([
        'revoke-link',
        'A'.repeat(22),
        '--apply',
        '--offline-confirmed',
        '--verified-case',
        'case-1',
      ]),
    ).toMatchObject({ command: 'revoke-link', target: 'A'.repeat(22) });
  });
  test('library also rejects missing verification before database access', async () => {
    const database = { query: jest.fn(), transaction: jest.fn() };
    const service = new AlphaSupportService(
      database as unknown as DatabaseService,
      {} as SharedAnalysesService,
    );
    await expect(
      service.apply('delete-account', ID, {
        apply: true,
        offlineConfirmed: true,
        confirmUser: OTHER,
        verifiedCase: 'case-1',
      }),
    ).rejects.toThrow();
    expect(database.query).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });
  test('retention work is bounded and reports backlog, never touches artifacts/canonical analyses', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.startsWith('SELECT now()'))
        return Promise.resolve({ rows: [{ cutoff: new Date('2026-01-01') }] });
      if (sql.startsWith('SELECT EXISTS'))
        return Promise.resolve({ rows: [{ remaining: true }] });
      return Promise.resolve({ rowCount: RETENTION_BATCH_SIZE, rows: [] });
    });
    const transaction = jest.fn(
      async (work: (client: { query: typeof query }) => Promise<unknown>) =>
        work({ query }),
    );
    const outcome = await purgeOldProductEvents({
      query,
      transaction,
    } as unknown as DatabaseService);
    expect(transaction).toHaveBeenCalledTimes(RETENTION_MAX_BATCHES);
    expect(outcome).toEqual({
      retentionDays: 90,
      removed: RETENTION_BATCH_SIZE * RETENTION_MAX_BATCHES,
      backlogRemaining: true,
    });
    expect(
      query.mock.calls
        .filter(([sql]) => sql.startsWith('DELETE'))
        .every(
          ([sql]) =>
            sql.includes('DELETE FROM product_events') &&
            sql.includes('occurred_at < $1'),
        ),
    ).toBe(true);
  });
});
