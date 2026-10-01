import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { documentPreview } from '../packages/core/dist/preview.js';
const destination = 'packages/server/public/guides';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir(destination, { recursive: true });
for (const [slug, filename, title] of [
  ['connect', 'CONNECT', 'Connect your application'],
  ['integration', 'INTEGRATION', 'Runtime integration'],
  ['api', 'API', 'HTTP API v1'],
]) {
  const content = (await readFile(`docs/${filename}.md`, 'utf8')).replaceAll('VERSION', version);
  // The same parser-backed sanitizer used for review previews keeps docs executable-free.
  const body = documentPreview(content, 'markdown');
  await writeFile(
    `${destination}/${slug}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | EveryLocale</title><link rel="stylesheet" href="/assets/workspace.css"></head><body><main class="guide-document"><a class="text-button" href="/"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12H4 M10 6l-6 6 6 6"/></svg>Return to workspace</a><article>${body}</article></main></body></html>`,
  );
}
