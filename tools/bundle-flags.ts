import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_LOCALES, ARABIC_COUNTRY_CODES } from '../packages/core/dist/locales.js';
const countries = [
  ...new Set([
    ...ARABIC_COUNTRY_CODES.map((country) => country.toLowerCase()),
    ...DEFAULT_LOCALES.flatMap((locale) => (locale.flag ? [locale.flag] : [])),
  ]),
];
const manifest = fileURLToPath(import.meta.resolve('flag-icons/package.json'));
const source = dirname(manifest);
const { version } = JSON.parse(await readFile(manifest, 'utf8')) as { version: string };
const flags = Object.fromEntries(
  await Promise.all(
    countries.map(
      async (country): Promise<[string, string]> => [
        country,
        await readFile(join(source, 'flags', '4x3', `${country}.svg`), 'utf8'),
      ],
    ),
  ),
);
await writeFile(
  'packages/react/src/flags.ts',
  `// Bundled flag-icons ${version} assets. MIT copyright Panayiotis Lipiridis.\nexport const FLAGS:Readonly<Record<string,string>>=${JSON.stringify(flags)};\n`,
);
await mkdir('packages/react/assets', { recursive: true });
await copyFile(join(source, 'LICENSE'), 'packages/react/assets/flag-icons.LICENSE');
await mkdir('packages/server/public/flags', { recursive: true });
for (const [country, svg] of Object.entries(flags))
  await writeFile(`packages/server/public/flags/${country}.svg`, svg);
await copyFile(join(source, 'LICENSE'), 'packages/server/public/flags/LICENSE');
