import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
if (!process.env.npm_execpath) throw new Error('Run through pnpm test:next.');
const pnpm = process.env.npm_execpath;
const directory = await mkdtemp(join(tmpdir(), 'everylocale-next-'));
const fixture = resolve('examples/next');
let child;
async function run(args) {
  await new Promise((done, reject) => {
    const processChild = spawn(process.execPath, [pnpm, ...args], {
      cwd: directory,
      stdio: 'inherit',
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    processChild.on('error', reject);
    processChild.on('exit', (code) =>
      code === 0
        ? done()
        : reject(new Error(`Next consumer ${args.join(' ')} failed with ${code}.`)),
    );
  });
}
try {
  await cp(join(fixture, 'app'), join(directory, 'app'), { recursive: true });
  await cp(join(fixture, 'next.config.mjs'), join(directory, 'next.config.mjs'));
  await cp(join(fixture, 'tsconfig.json'), join(directory, 'tsconfig.json'));
  const manifest = JSON.parse(await readFile(join(fixture, 'package.json'), 'utf8'));
  for (const name of ['core', 'adapters', 'react'])
    manifest.dependencies[`@everylocale/${name}`] =
      'file:' + resolve(`artifacts/everylocale-${name}-0.2.0.tgz`).replaceAll('\\', '/');
  manifest.pnpm = {
    overrides: { '@everylocale/core': manifest.dependencies['@everylocale/core'] },
  };
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2));
  await run(['install', '--ignore-workspace']);
  await run(['build']);
  // Consumer installation must not share the workspace's React 18 type dependencies.
  child = spawn(process.execPath, [pnpm, 'start'], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const deadline = Date.now() + 60000;
  while (true) {
    try {
      if ((await fetch('http://localhost:4315/about')).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const responses = await Promise.all(
    ['/ar/about', '/zh-tw/about', '/de/about'].map((path) =>
      fetch('http://localhost:4315' + path, {
        headers: { cookie: 'el_locale=en', 'accept-language': 'fr' },
      }),
    ),
  );
  for (const response of responses) assert.equal(response.status, 200);
  const [ar, zh, de] = await Promise.all(responses.map((response) => response.text()));
  assert.match(ar, /lang="ar" dir="rtl"/);
  assert.match(ar, /مرحبًا Ali/);
  assert.match(zh, /你好 Ali/);
  assert.match(de, /Hallo Ali/);
  assert.match(zh, /<svg/);
  assert.match(ar, /rel="canonical" href="https:\/\/example.test\/ar\/about"/);
  assert.match(ar, /hrefLang="zh-Hant-TW"/i);
  assert.match(zh, /hrefLang="ar"/i);
  assert.match(ar, /x-default/);
  const stylesheets = [...ar.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((match) => match[1]);
  assert.ok(stylesheets.length, 'The packaged font stylesheet must be delivered');
  const deliveredFonts = new Set();
  for (const href of stylesheets) {
    const cssUrl = new URL(href, 'http://localhost:4315');
    const cssResponse = await fetch(cssUrl);
    assert.equal(cssResponse.status, 200);
    const css = await cssResponse.text();
    for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
      const url = new URL(match[1].trim().replace(/^['"]|['"]$/g, ''), cssUrl);
      if (!url.pathname.endsWith('.woff2')) continue;
      assert.equal(url.origin, 'http://localhost:4315');
      const font = await fetch(url);
      assert.equal(font.status, 200);
      assert.equal(
        Buffer.from(await font.arrayBuffer())
          .subarray(0, 4)
          .toString(),
        'wOF2',
      );
      deliveredFonts.add(url.href);
    }
  }
  assert.ok(
    deliveredFonts.size >= 3,
    'Arabic, full Taiwan and Taiwan label fonts must be packaged',
  );
  const unavailable = await fetch('http://localhost:4315/fr/about');
  assert.equal(unavailable.status, 404);
  assert.match(await unavailable.text(), /Read the original page/);
  assert.equal((await fetch('http://localhost:4315/zh-cn/about')).status, 404);
  console.log(
    'Next.js 16 production build, React 19 runtime, server rendering, metadata, concurrent catalog isolation, and unpublished-route checks passed.',
  );
} finally {
  if (child?.pid) {
    if (process.platform === 'win32')
      await new Promise((done) =>
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }).on(
          'exit',
          done,
        ),
      );
    else {
      process.kill(-child.pid, 'SIGTERM');
      await new Promise((done) => child.on('exit', done));
    }
  }
  await rm(directory, { recursive: true, force: true });
}
