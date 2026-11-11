import { SqliteStore } from '@everylocale/store';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { TranslationWorker } from './worker.js';
import { DeliveryWorker } from './delivery.js';
import { BackupScheduler } from './backups.js';
import { databasePath } from './paths.js';

/** How often queue health, provider availability and failure alerts are evaluated. */
const HEALTH_INTERVAL_MS = 30000;

const store = new SqliteStore(databasePath());
const config = loadConfig(store);
let worker: TranslationWorker | null = null;
const app = await createApp(store, {
  ...config,
  providersReady: Boolean(config.worker),
  providers: {
    status: () => worker?.status() ?? null,
    resume: () => worker?.resume(),
  },
});
if (store.migration.from !== store.migration.to)
  app.log.warn(
    { event: 'database_migrated', ...store.migration },
    'database schema upgraded; the previous version was backed up first',
  );
worker = config.worker ? new TranslationWorker(store, config.worker, app.log) : null;
const delivery = config.delivery ? new DeliveryWorker(store, config.delivery) : null;
const backups = config.backups ? new BackupScheduler(store, config.backups, app.log) : null;
await app.listen({ host: config.host, port: config.port });
worker?.start();
delivery?.start();
backups?.start();
const checkHealth = () => {
  try {
    store.checkHealth(worker?.available() ?? false);
  } catch (error) {
    app.log.error({ err: error, event: 'health_check_failed' }, 'could not record queue health');
  }
};
checkHealth();
const healthTimer = setInterval(checkHealth, HEALTH_INTERVAL_MS);
healthTimer.unref();
app.log.info(
  {
    event: 'started',
    origin: config.publicOrigin,
    providers: worker ? 'configured' : 'not_configured',
    backups: backups ? 'scheduled' : 'manual',
  },
  'EveryLocale is listening',
);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(healthTimer);
  await app.close();
  await worker?.stop();
  await delivery?.stop();
  await backups?.stop();
  store.close();
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
