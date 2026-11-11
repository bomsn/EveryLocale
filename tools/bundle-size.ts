import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { parserAlias } from '../packages/runtime/dist/bundler.js';

/**
 * What each browser entry may add to an app, gzipped, with React itself external. A change that
 * pulls in a Node built-in, the ICU parser or the full flag set fails here.
 */
const ENTRIES = [
  {
    name: '@everylocale/runtime',
    budget: 3_500,
    code: "import { createFormatter } from './packages/runtime/dist/index.js'; console.log(createFormatter({ locale: 'de', messages: {} }).format('a'));",
  },
  {
    name: '@everylocale/react messages',
    budget: 3_800,
    code: "import { EveryLocaleProvider, Message, useMessages } from './packages/react/dist/index.js'; console.log(EveryLocaleProvider, Message, useMessages);",
  },
  {
    name: '@everylocale/react language controls',
    budget: 1_800,
    code: "import { LanguageLinks, LanguageSelect, LanguageSuggestion, LocaleFlag } from './packages/react/dist/index.js'; console.log(LanguageLinks, LanguageSelect, LanguageSuggestion, LocaleFlag);",
  },
  {
    name: '@everylocale/adapters',
    budget: 2_700,
    code: "import { resolveRequest, switchPage, PublishedRegistry } from './packages/adapters/dist/index.js'; console.log(resolveRequest, switchPage, PublishedRegistry);",
  },
  {
    name: '@everylocale/react/flags/tw',
    budget: 1_200,
    code: "import tw from './packages/react/flags/tw.js'; console.log(tw);",
  },
] as const;

let failed = false;
for (const entry of ENTRIES) {
  const result = await build({
    stdin: { contents: entry.code, resolveDir: process.cwd(), loader: 'js' },
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    alias: parserAlias(),
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  }).catch((error: unknown) => {
    failed = true;
    console.error(`${entry.name}: cannot be bundled for the browser\n${String(error)}`);
    return null;
  });
  const output = result?.outputFiles[0];
  if (!output) continue;
  const size = gzipSync(output.contents, { level: 9 }).length;
  const over = size > entry.budget;
  failed ||= over;
  console.log(
    `${over ? 'OVER' : 'ok  '} ${entry.name.padEnd(40)} ${String(size).padStart(6)} B gzip (budget ${String(entry.budget)})`,
  );
}
if (failed) process.exitCode = 1;
