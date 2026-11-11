import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseAppConfig } from '../packages/core/dist/config.js';
import { releaseFromFiles, withLocalService } from './local-service.ts';
import { runPnpm } from './process.ts';

/**
 * Prepares and drives the React Router example the way an app team would. The real service
 * and CLI sync the source messages, import the example's hand-written translations, and pull a
 * verified release. The example is then checked offline, type-checked including its typed
 * message proofs, built for production, and tested in Chromium. The service's own workspace
 * is checked for accessibility in the same run.
 */
const example = resolve('examples/react-router');
const config = parseAppConfig(
  JSON.parse(await readFile(join(example, 'everylocale.config.json'), 'utf8')),
);
await withLocalService(
  config,
  async (service) => {
    process.stdout.write(await releaseFromFiles(service, example, config));
    process.stdout.write(await service.cli(example, 'codegen', '--check'));
    process.stdout.write(await service.cli(example, 'check', '--code', 'app'));
    const filter = ['--filter', 'everylocale-react-router-example'];
    await runPnpm([...filter, 'typecheck']);
    await runPnpm([...filter, 'build']);
    await runPnpm([...filter, 'exec', 'playwright', 'install', 'chromium']);
    await runPnpm([...filter, 'test:browser'], {
      env: {
        ...process.env,
        EVERYLOCALE_WORKSPACE_URL: service.url,
        EVERYLOCALE_ADMIN_TOKEN: service.adminToken,
      },
    });
  },
  4317,
);
