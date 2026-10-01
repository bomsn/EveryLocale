import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

if (!process.env.npm_execpath) throw new Error('Run through pnpm ci:local.');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));

async function run(command, args) {
  console.log(`Running ${command === process.execPath ? 'pnpm' : command} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`Check failed: ${code ?? signal}`)),
    );
  });
}

await run('docker', ['info', '--format', '{{.OSType}}']);
await run(process.execPath, [process.env.npm_execpath, 'ci:host']);
for (const nodeVersion of ['22', '24']) {
  await run('docker', [
    'build',
    '--target',
    'verify',
    '--build-arg',
    `NODE_VERSION=${nodeVersion}`,
    '-t',
    `everylocale-local-ci:node${nodeVersion}`,
    '.',
  ]);
}
await run('docker', ['build', '-t', `everylocale:${version}`, '.']);
await run(process.execPath, [process.env.npm_execpath, 'test:wordpress']);
console.log('Local CI passed: host checks, Linux Node 22/24, packaged Next.js, and WordPress.');
