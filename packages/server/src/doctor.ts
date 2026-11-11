import { existsSync } from 'node:fs';
import { SqliteStore, verifyDatabase } from '@everylocale/store';
import { loadConfig } from './config.js';
import { databasePath } from './paths.js';

/**
 * Checks configuration and storage without changing anything: the database is verified
 * read-only, and it is opened normally only when it is already at the current schema, so
 * running the doctor never upgrades or creates a database.
 */
let store: SqliteStore | undefined;
try {
  const path = databasePath();
  const check = existsSync(path) ? verifyDatabase(path) : null;
  if (check?.current) store = new SqliteStore(path);
  const config = loadConfig(store);
  console.log('Workspace credentials: configured');
  if (!check) console.log('Database: not created yet; the service creates it on first start');
  else if (check.current) console.log('Database: readable and consistent');
  else
    console.log(
      `Database: consistent at schema version ${String(check.schemaVersion)}; the service upgrades it on next start after backing it up`,
    );
  console.log(`Workspace address: ${config.publicOrigin}`);
  if (!config.worker) {
    console.error(
      'Translation is not configured yet. Set both model roles in .env, then run pnpm doctor again. Follow docs/GETTING-STARTED.md.',
    );
    process.exitCode = 1;
  } else {
    console.log('Generation and review: configured');
    console.log(
      'Configuration checks passed. No model request was sent. Translate a small file to verify model access and output.',
    );
  }
} catch (error) {
  console.error(
    `Setup needs attention: ${error instanceof Error ? error.message : 'Check configuration and storage permissions'}`,
  );
  console.error(
    'Follow docs/GETTING-STARTED.md and docs/CONFIGURATION.md. Credentials were not printed.',
  );
  process.exitCode = 1;
} finally {
  store?.close();
}
