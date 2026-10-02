import { SqliteStore } from '@everylocale/store';
import { loadConfig } from './config.js';
import { databasePath } from './paths.js';

let store: SqliteStore | undefined;
try {
  store = new SqliteStore(databasePath());
  const config = loadConfig(store);
  if (
    store.db.pragma('quick_check', { simple: true }) !== 'ok' ||
    (store.db.pragma('foreign_key_check') as unknown[]).length
  )
    throw new Error('Database integrity verification failed');
  console.log('Workspace credentials: configured');
  console.log('Database: readable, writable, and consistent');
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
