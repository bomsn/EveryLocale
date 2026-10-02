import { SqliteStore } from '@everylocale/store';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { TranslationWorker } from './worker.js';
import { DeliveryWorker } from './delivery.js';
import { resolve } from 'node:path';

const store = new SqliteStore(
  resolve(process.env.EVERYLOCALE_DATABASE ?? '../../data/everylocale.sqlite'),
);
const config = loadConfig(store);
const app = await createApp(store, { ...config, providersReady: Boolean(config.worker) });
const worker = config.worker ? new TranslationWorker(store, config.worker) : null;
const delivery = config.delivery ? new DeliveryWorker(store, config.delivery) : null;
await app.listen({ host: config.host, port: config.port });
worker?.start();
delivery?.start();
const checkHealth = () => {
  try {
    store.checkHealth(
      Boolean(config.worker) &&
        config.worker?.generator.available?.() !== false &&
        config.worker?.reviewer.available?.() !== false,
    );
  } catch {
    console.error('EveryLocale could not record queue health');
  }
};
checkHealth();
const healthTimer = setInterval(checkHealth, 30000);
healthTimer.unref();
console.log(
  `EveryLocale listening on ${config.publicOrigin}. Translation providers ${worker ? 'configured' : 'not configured'}.`,
);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(healthTimer);
  await app.close();
  await worker?.stop();
  await delivery?.stop();
  store.close();
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
