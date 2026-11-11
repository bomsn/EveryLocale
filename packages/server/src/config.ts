import { resolve } from 'node:path';
import { databasePath } from './paths.js';
import { validateProvider, type ProviderConfig } from '@everylocale/core';
import type { WorkerConfig } from './worker.js';
import { LOG_LEVELS, type LogLevel } from './http/context.js';
import { validateDelivery } from './delivery.js';
import { ChatGptConnection } from './chatgpt.js';
import type { SqliteStore } from '@everylocale/store';

function provider(prefix: string, connection?: ChatGptConnection): ProviderConfig | null {
  const kind = process.env[`${prefix}_PROVIDER`] ?? 'openai-compatible';
  if (kind === 'chatgpt') {
    if (!connection)
      throw new Error('Configure EVERYLOCALE_CHATGPT_SECRET and connect a ChatGPT account first');
    const account = process.env[`${prefix}_ACCOUNT`],
      model = process.env[`${prefix}_MODEL`];
    if (!account || !model)
      throw new Error(`${prefix} requires a saved ChatGPT account and a discovered model`);
    return connection.provider(account, model);
  }
  if (kind !== 'openai-compatible') throw new Error('Unknown translation provider');
  const baseUrl = process.env[`${prefix}_URL`],
    model = process.env[`${prefix}_MODEL`];
  if (!baseUrl && !model) return null;
  const input = process.env[`${prefix}_INPUT_PRICE`],
    output = process.env[`${prefix}_OUTPUT_PRICE`];
  if (input === undefined || input === '' || output === undefined || output === '')
    throw new Error(`${prefix} requires explicit token prices`);
  const result = {
    baseUrl: baseUrl ?? '',
    apiKey: process.env[`${prefix}_KEY`],
    model: model ?? '',
    inputPrice: Number(input),
    outputPrice: Number(output),
    maxOutputTokens: Number(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] ?? 4096),
    reasoningEffort: process.env[`${prefix}_REASONING_EFFORT`],
  };
  validateProvider(result);
  return result;
}
export function loadConfig(store?: SqliteStore) {
  const adminToken = process.env.EVERYLOCALE_ADMIN_TOKEN ?? '';
  const sessionSecret = process.env.EVERYLOCALE_SESSION_SECRET ?? '';
  if (adminToken.length < 32 || sessionSecret.length < 32 || adminToken === sessionSecret)
    throw new Error(
      'Independent admin token and session secret of at least 32 characters are required',
    );
  const connection =
    store && process.env.EVERYLOCALE_CHATGPT_SECRET
      ? new ChatGptConnection(store, process.env.EVERYLOCALE_CHATGPT_SECRET)
      : undefined;
  const generator = provider('EVERYLOCALE_GENERATOR', connection),
    reviewer = provider('EVERYLOCALE_REVIEWER', connection);
  if (Boolean(generator) !== Boolean(reviewer))
    throw new Error('Configure both generation and review providers, or neither');
  const delivery = process.env.EVERYLOCALE_WEBHOOK_URL
    ? {
        url: process.env.EVERYLOCALE_WEBHOOK_URL,
        secret: process.env.EVERYLOCALE_WEBHOOK_SECRET ?? '',
      }
    : null;
  if (delivery) validateDelivery(delivery);
  const host = process.env.EVERYLOCALE_HOST ?? '127.0.0.1';
  const logLevel = process.env.EVERYLOCALE_LOG_LEVEL ?? 'info';
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel))
    throw new Error(`EVERYLOCALE_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  // Behind a reverse proxy, only the listed proxies may supply the client address.
  const trustProxy: string | false = process.env.EVERYLOCALE_TRUST_PROXY?.trim() || false;
  const backupDirectory = process.env.EVERYLOCALE_BACKUP_DIR?.trim();
  const backupHours = Number(process.env.EVERYLOCALE_BACKUP_INTERVAL_HOURS ?? 24);
  const backupKeep = Number(process.env.EVERYLOCALE_BACKUP_KEEP ?? 7);
  if (
    backupDirectory &&
    (!Number.isFinite(backupHours) ||
      backupHours <= 0 ||
      !Number.isInteger(backupKeep) ||
      backupKeep < 1)
  )
    throw new Error('Backup interval must be positive hours and retention at least one backup');
  const backups = backupDirectory
    ? { directory: resolve(backupDirectory), intervalMs: backupHours * 3600000, keep: backupKeep }
    : null;
  const concurrency = Number(process.env.EVERYLOCALE_CONCURRENCY ?? 2);
  const intervalMs = Number(process.env.EVERYLOCALE_PROVIDER_INTERVAL_MS ?? 500);
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 16 ||
    !Number.isInteger(intervalMs) ||
    intervalMs < 0
  )
    throw new Error('Invalid worker limits');
  const port = Number(process.env.EVERYLOCALE_PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const origin = new URL(process.env.EVERYLOCALE_PUBLIC_ORIGIN ?? `http://localhost:${port}`);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      'EVERYLOCALE_PUBLIC_ORIGIN must be an HTTP origin without a path or credentials',
    );
  if (
    !['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname) &&
    origin.protocol !== 'https:'
  )
    throw new Error('Remote access requires an HTTPS public origin');
  return {
    host,
    delivery,
    connection,
    port,
    adminToken,
    sessionSecret,
    database: databasePath(),
    publicOrigin: origin.origin,
    logLevel: logLevel as LogLevel,
    trustProxy,
    // Every response is checked against its declared schema except in production.
    validateResponses: process.env.NODE_ENV !== 'production',
    backups,
    secureCookie: origin.protocol === 'https:',
    worker:
      generator && reviewer
        ? ({ generator, reviewer, concurrency, intervalMs } satisfies WorkerConfig)
        : null,
  };
}
