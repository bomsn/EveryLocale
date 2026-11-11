import { releaseVersion, run, runPnpm } from './process.js';

await run('docker', ['info', '--format', '{{.OSType}}']);
await runPnpm(['ci:host']);
for (const nodeVersion of ['22', '24'])
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
await run('docker', ['build', '-t', `everylocale:${releaseVersion()}`, '.']);
await runPnpm(['test:wordpress']);
console.log('Local CI passed: host checks, Linux Node 22/24, packaged Next.js, and WordPress.');
