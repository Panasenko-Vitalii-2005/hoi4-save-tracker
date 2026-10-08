/* Config-only: no daemon, containers, production .env, or full config output. */
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const defaults = {
  HOI4_REGISTRATION_INVITE_ONLY: 'false',
  HOI4_REGISTRATION_ALLOWLIST: '',
  HOI4_ABUSE_PROTECTION_ENABLED: 'false',
  HOI4_TRUSTED_PROXY_CIDRS: '',
  HOI4_SUPPORT_EMAIL: '',
  HOI4_ANALYSIS_RESULTS_MAX_BYTES: '134217728',
  HOI4_RECENT_ANALYSES_LIMIT: '200',
  HOI4_SHARED_ANALYSES_LIMIT: '1000',
  HOI4_ANALYSIS_CACHE_ENTRIES: '3',
  HOI4_TRENDS_CACHE_SNAPSHOTS: '2048',
  HOI4_TRENDS_CACHE_BYTES: '67108864',
  HOI4_MAX_UPLOAD_BYTES: '268435456',
  HOI4_MAX_UNCOMPRESSED_BYTES: '536870912',
  HOI4_UPLOAD_TIMEOUT_MS: '120000',
  HOI4_ANALYSIS_TIMEOUT_MS: '60000',
  HOI4_ANALYSIS_HEAP_MB: '1024',
  HOI4_ANALYSIS_WORKERS: '1',
  HOI4_ANALYSIS_REQUESTS: '2',
};
const overrides = {
  HOI4_REGISTRATION_INVITE_ONLY: 'true',
  HOI4_REGISTRATION_ALLOWLIST: 'invited@example.invalid',
  HOI4_ABUSE_PROTECTION_ENABLED: 'true',
  HOI4_TRUSTED_PROXY_CIDRS: '172.28.0.0/24',
  HOI4_SUPPORT_EMAIL: 'alpha-support@example.invalid',
  HOI4_ANALYSIS_RESULTS_MAX_BYTES: '2147483648',
  HOI4_RECENT_ANALYSES_LIMIT: '101',
  HOI4_SHARED_ANALYSES_LIMIT: '77',
  HOI4_ANALYSIS_CACHE_ENTRIES: '2',
  HOI4_TRENDS_CACHE_SNAPSHOTS: '128',
  HOI4_TRENDS_CACHE_BYTES: '8388608',
  HOI4_MAX_UPLOAD_BYTES: '134217728',
  HOI4_MAX_UNCOMPRESSED_BYTES: '268435456',
  HOI4_UPLOAD_TIMEOUT_MS: '90000',
  HOI4_ANALYSIS_TIMEOUT_MS: '45000',
  HOI4_ANALYSIS_HEAP_MB: '768',
  HOI4_ANALYSIS_WORKERS: '2',
  HOI4_ANALYSIS_REQUESTS: '3',
};

// Shell interpolation must not pick up an operator's real credentials/settings.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(HOI4_|POSTGRES_|PRIVATE_ALPHA_|ACME_EMAIL$|COMPOSE_|DATABASE_URL$)/i.test(
        key,
      ),
  ),
);
for (const alpha of [false, true]) {
  for (const custom of [false, true]) {
    const args = [
      'compose',
      '--project-directory',
      root,
      '--project-name',
      'hoi4-capacity-config-test',
      '--env-file',
      resolve(root, 'server/src/analyze/fixtures/capacity-compose.env'),
      '-f',
      resolve(root, 'docker-compose.yml'),
      ...(alpha
        ? ['-f', resolve(root, 'docker-compose.private-alpha.yml')]
        : []),
      'config',
      '--format',
      'json',
    ];
    const config = JSON.parse(
      execFileSync('docker', args, {
        env: { ...env, ...(custom ? overrides : {}) },
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      }),
    );
    const expected = { ...defaults, ...(custom ? overrides : {}) };
    if (alpha) {
      expected.HOI4_ANALYSIS_WORKERS = '1';
      expected.HOI4_ANALYSIS_REQUESTS = '2';
      assert.equal(
        config.services.backend.environment.HOI4_LOCAL_SAVES_ENABLED,
        'false',
      );
      assert.equal(config.services.backend.volumes.length, 1);
      assert.equal(config.services.backend.volumes[0].target, '/app/data');
    }
    for (const [key, value] of Object.entries(expected))
      assert.equal(
        String(config.services.backend.environment[key]),
        value,
        key,
      );
    console.log(
      `PASS ${alpha ? 'private-alpha' : 'local'} ${custom ? 'overrides' : 'defaults'}: ${Object.keys(expected).length} capacity/security settings`,
    );
  }
}
