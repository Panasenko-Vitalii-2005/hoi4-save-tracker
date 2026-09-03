export type DatabaseConfig =
  | { enabled: false; connectionString: null }
  | { enabled: true; connectionString: string };

export function databaseEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.HOI4_DATABASE_ENABLED?.trim().toLowerCase() === 'true';
}

export function databaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseConfig {
  if (!databaseEnabled(environment)) {
    return { enabled: false, connectionString: null };
  }

  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required when HOI4_DATABASE_ENABLED=true');
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length <= 1
  ) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  return { enabled: true, connectionString };
}
