import 'reflect-metadata';
import { databaseConfig } from '../database/database.config';
import {
  DatabaseService,
  createDatabasePool,
} from '../database/database.service';
import { PersistedAnalysisResultService } from '../analyze/persisted-analysis-result.service';
import {
  SharedAnalysesService,
  normalizeShareId,
} from '../analyze/shared-analyses.service';
import {
  AlphaSupportService,
  accountId,
  purgeOldProductEvents,
  type AccountAction,
} from './alpha-support.service';

export function parseSupportCommand(args: readonly string[]) {
  const [command, ...rest] = args;
  if (command === 'preview' && rest.length === 1)
    return { command, target: accountId(rest[0]) } as const;
  if (
    ![
      'revoke-sessions',
      'disable',
      'delete-account',
      'purge-telemetry',
      'revoke-link',
    ].includes(command)
  )
    throw new Error('Unknown support command');
  const rawTarget = command === 'purge-telemetry' ? null : (rest.shift() ?? '');
  const target =
    command === 'revoke-link'
      ? normalizeShareId(rawTarget!)
      : rawTarget === null
        ? null
        : accountId(rawTarget);
  if (command === 'revoke-link' && !target)
    throw new Error('Invalid share identifier');
  const flags = new Map<string, string | boolean>();
  while (rest.length) {
    const flag = rest.shift()!;
    if (flags.has(flag)) throw new Error('Duplicate option');
    if (flag === '--apply' || flag === '--offline-confirmed')
      flags.set(flag, true);
    else if (
      target &&
      (flag === '--confirm-user' || flag === '--verified-case')
    ) {
      const value = rest.shift();
      if (!value || value.startsWith('--'))
        throw new Error('Missing confirmation value');
      flags.set(flag, value);
    } else throw new Error('Unknown option');
  }
  if (!flags.get('--apply') || !flags.get('--offline-confirmed'))
    throw new Error('Applying requires --apply and --offline-confirmed');
  const confirmation = {
    apply: true,
    offlineConfirmed: true,
    confirmUser: String(flags.get('--confirm-user') ?? ''),
    verifiedCase: String(flags.get('--verified-case') ?? ''),
  };
  if (
    target &&
    ((command !== 'revoke-link' &&
      accountId(confirmation.confirmUser) !== target) ||
      !/^[A-Za-z0-9_-]{3,80}$/.test(confirmation.verifiedCase))
  )
    throw new Error('Matching UUID and verified case required');
  return {
    command: command as AccountAction | 'purge-telemetry' | 'revoke-link',
    target,
    confirmation,
  } as const;
}

async function main() {
  // Validate before opening any database or file. No app bootstrap, HTTP server,
  // Recent reconciliation, source uploads, or automatic physical cleanup.
  const command = parseSupportCommand(process.argv.slice(2));
  const config = databaseConfig();
  if (!config.enabled) throw new Error('Database must be configured');
  const database = new DatabaseService(config, createDatabasePool);
  try {
    await database.onModuleInit();
    let outcome: unknown;
    if (command.command === 'purge-telemetry')
      outcome = await purgeOldProductEvents(database);
    else {
      const shares = new SharedAnalysesService(
        new PersistedAnalysisResultService(),
        false,
      );
      const support = new AlphaSupportService(database, shares);
      outcome =
        command.command === 'revoke-link'
          ? {
              revoked: await shares.revokeById(command.target!),
              physicalArtifactsErased: false,
            }
          : command.command === 'preview'
            ? await support.preview(command.target)
            : await support.apply(
                command.command,
                command.target!,
                command.confirmation,
              );
    }
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } finally {
    await database.onModuleDestroy();
  }
}

if (require.main === module)
  void main().catch(() => {
    // Never print URLs, emails, tokens, SQL errors or filesystem paths.
    process.stderr.write(
      'Support operation failed. Check confirmations, offline/exclusive access, database and share-store health. Account deletion may have left the account disabled; preview before retry.\n',
    );
    process.exitCode = 1;
  });
