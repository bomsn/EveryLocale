import { resolve } from 'node:path';
import { validateProvider, type ProviderConfig } from '@everylocale/core';
import type { WorkerConfig } from './worker.js';

function provider(prefix: string): ProviderConfig | null {
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
  };
  validateProvider(result);
  return result;
}
export function loadConfig() {
  const adminToken = process.env.EVERYLOCALE_ADMIN_TOKEN ?? '';
  const sessionSecret = process.env.EVERYLOCALE_SESSION_SECRET ?? '';
  if (adminToken.length < 32 || sessionSecret.length < 32 || adminToken === sessionSecret)
    throw new Error(
      'Independent admin token and session secret of at least 32 characters are required',
    );
  const generator = provider('EVERYLOCALE_GENERATOR'),
    reviewer = provider('EVERYLOCALE_REVIEWER');
  if (Boolean(generator) !== Boolean(reviewer))
    throw new Error('Configure both generation and review providers, or neither');
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
  return {
    host: process.env.EVERYLOCALE_HOST ?? '127.0.0.1',
    port,
    adminToken,
    sessionSecret,
    database: resolve(process.env.EVERYLOCALE_DATABASE ?? '../../data/everylocale.sqlite'),
    publicOrigin: origin.origin,
    secureCookie: origin.protocol === 'https:',
    worker:
      generator && reviewer
        ? ({ generator, reviewer, concurrency, intervalMs } satisfies WorkerConfig)
        : null,
  };
}
