import { SqliteStore } from '@everylocale/store';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { TranslationWorker } from './worker.js';

const config = loadConfig();
const store = new SqliteStore(config.database);
const app = await createApp(store, { ...config, providersReady: Boolean(config.worker) });
const worker = config.worker ? new TranslationWorker(store, config.worker) : null;
worker?.start();
await app.listen({ host: config.host, port: config.port });
console.log(
  `EveryLocale listening on ${config.publicOrigin}. Translation providers ${worker ? 'configured' : 'not configured'}.`,
);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  await worker?.stop();
  store.close();
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
