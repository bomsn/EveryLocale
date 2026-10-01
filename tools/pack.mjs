import { spawnSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve('artifacts');
await mkdir(destination, { recursive: true });
for (const name of ['core', 'react', 'adapters', 'store', 'cli', 'server']) {
  await copyFile('LICENSE', `packages/${name}/LICENSE`);
  if (!process.env.npm_execpath)
    throw new Error('Run package preparation through pnpm release:pack.');
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, 'pack', '--pack-destination', destination],
    { cwd: resolve('packages', name), stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error(`Failed to pack ${name}`);
}
