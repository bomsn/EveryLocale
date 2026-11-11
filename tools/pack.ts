import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runPnpm } from './process.js';

const destination = resolve('artifacts');
await mkdir(destination, { recursive: true });
for (const name of ['core', 'runtime', 'react', 'adapters', 'store', 'cli', 'server']) {
  await copyFile('LICENSE', `packages/${name}/LICENSE`);
  await runPnpm(['pack', '--pack-destination', destination], { cwd: resolve('packages', name) });
}
