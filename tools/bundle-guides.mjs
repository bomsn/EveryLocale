import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { posix } from 'node:path';
import { documentPreview } from '../packages/core/dist/preview.js';

const destination = 'packages/server/public/guides';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const guides = [
  ['getting-started', 'docs/GETTING-STARTED.md', 'Translate your first file'],
  ['workflow', 'docs/WORKFLOW.md', 'How it works'],
  ['connect', 'docs/CONNECT.md', 'Connect your app'],
  ['ci-cd', 'docs/CI-CD.md', 'GitHub Actions and CI/CD'],
  ['cli', 'docs/CLI.md', 'CLI reference'],
  ['configuration', 'docs/CONFIGURATION.md', 'Model settings'],
  ['operations', 'docs/OPERATIONS.md', 'Hosting, backups, and alerts'],
  ['integration', 'docs/INTEGRATION.md', 'Language and SEO integration'],
  ['api', 'docs/API.md', 'HTTP API'],
  ['wordpress', 'adapters/wordpress/README.md', 'WordPress setup'],
];
const byFile = new Map(
  guides.map(([slug, filename]) => [filename, '/assets/guides/' + slug + '.html']),
);
await mkdir(destination, { recursive: true });
await mkdir(destination + '/examples', { recursive: true });
await cp('examples/messages.json', destination + '/examples/messages.json');
for (const [slug, filename, title] of guides) {
  const content = (await readFile(filename, 'utf8')).replaceAll('VERSION', version);
  // Public guides use an explicit link policy; untrusted review previews keep their links inactive.
  const body = documentPreview(content, 'markdown', {
    headingIds: true,
    focusableCode: true,
    link: (href) => {
      if (/^(?:https?:\/\/|#)/i.test(href)) return href;
      const [path, fragment] = href.split('#');
      const target = posix.normalize(posix.join(posix.dirname(filename), path));
      const local = byFile.get(target);
      if (local) return local + (fragment ? '#' + fragment : '');
      if (target === 'examples/messages.json') return '/assets/guides/examples/messages.json';
      return (
        'https://github.com/bomsn/EveryLocale/blob/develop/' +
        target +
        (fragment ? '#' + fragment : '')
      );
    },
  });
  const navigation = guides
    .map(
      ([id, , label]) =>
        `<a href="/assets/guides/${id}.html"${id === slug ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');
  await writeFile(
    `${destination}/${slug}.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | EveryLocale</title><link rel="stylesheet" href="/assets/workspace.css"></head><body><main class="guide-document"><a class="text-button" href="/">Return to workspace</a><nav class="guide-links" aria-label="Guides">${navigation}</nav><article>${body}</article></main></body></html>`,
  );
}
