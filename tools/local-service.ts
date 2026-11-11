import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectSchema } from '../packages/core/dist/index.js';
import type { AppConfig } from '../packages/core/dist/config.js';
import { SqliteStore } from '../packages/store/dist/index.js';
import { createApp } from '../packages/server/dist/app.js';

export type LocalService = {
  url: string;
  adminToken: string;
  store: SqliteStore;
  /** Runs the real CLI in an app directory with a scoped token; fails with its output. */
  cli(cwd: string, ...args: string[]): Promise<string>;
};

/**
 * Runs the real service on a temporary database for one app config. Its single policy has
 * people translate and approves their wording automatically after the structural checks, so
 * `everylocale import` of hand-written translations produces a release without any model.
 */
export async function withLocalService<T>(
  config: AppConfig,
  use: (service: LocalService) => Promise<T>,
  /** A fixed port, for browser sign-in, which checks the Origin header against the address. */
  port = 0,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'everylocale-service-'));
  const store = new SqliteStore(join(directory, 'service.sqlite'));
  const adminToken = 'owner-token-for-local-tests-only-0000';
  const origin = `http://127.0.0.1:${String(port)}`;
  const service = await createApp(store, {
    adminToken,
    sessionSecret: 'session-secret-for-local-tests-only-000',
    publicOrigin: origin,
    secureCookie: false,
    providersReady: true,
    logLevel: 'silent',
    trustProxy: false,
  });
  try {
    store.saveProject(
      projectSchema.parse({
        id: config.project,
        name: config.project,
        targetLocales: config.registry.slice(1).map((item) => item.id),
        budgetUsd: 1,
        policies: [{ match: {}, translate: 'human', approve: 'automatic' }],
      }),
    );
    await service.listen({ host: '127.0.0.1', port });
    const url = `http://127.0.0.1:${String((service.server.address() as { port: number }).port)}`;
    const token = store.mintToken(
      config.project,
      ['read', 'import', 'translate', 'export'],
      Date.now() + 600_000,
    );
    const cli = (cwd: string, ...args: string[]) =>
      new Promise<string>((done, reject) => {
        const child = spawn(process.execPath, [resolve('packages/cli/dist/index.js'), ...args], {
          cwd,
          env: { ...process.env, EVERYLOCALE_URL: url, EVERYLOCALE_TOKEN: token.token },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
        child.on('error', reject);
        child.on('exit', (code) => {
          if (code === 0) done(output);
          else reject(new Error(`everylocale ${args.join(' ')} failed:\n${output}`));
        });
      });
    return await use({ url, adminToken, store, cli });
  } finally {
    await service.close();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/** Syncs the sources, imports every target locale's existing files, and pulls a release. */
export async function releaseFromFiles(service: LocalService, app: string, config: AppConfig) {
  await service.cli(app, 'sync');
  for (const locale of config.registry.slice(1))
    await service.cli(app, 'import', '--locale', locale.id);
  return service.cli(app, 'pull');
}
