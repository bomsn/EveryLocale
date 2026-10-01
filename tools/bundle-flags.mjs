import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { DEFAULT_LOCALES, ARABIC_COUNTRY_CODES } from '../packages/core/dist/locales.js';
const countries = [
  ...new Set([
    ...ARABIC_COUNTRY_CODES.map((country) => country.toLowerCase()),
    ...DEFAULT_LOCALES.flatMap((locale) => (locale.flag ? [locale.flag] : [])),
  ]),
];
const flags = Object.fromEntries(
  await Promise.all(
    countries.map(async (country) => [
      country,
      await readFile(`node_modules/flag-icons/flags/4x3/${country}.svg`, 'utf8'),
    ]),
  ),
);
await writeFile(
  'packages/react/src/flags.ts',
  `// Bundled flag-icons 7.5.0 assets. MIT copyright Panayiotis Lipiridis.\nexport const FLAGS:Readonly<Record<string,string>>=${JSON.stringify(flags)};\n`,
);
await mkdir('packages/react/assets', { recursive: true });
await copyFile('node_modules/flag-icons/LICENSE', 'packages/react/assets/flag-icons.LICENSE');
await mkdir('packages/server/public/flags', { recursive: true });
for (const country of countries)
  await writeFile(`packages/server/public/flags/${country}.svg`, flags[country]);
await copyFile('node_modules/flag-icons/LICENSE', 'packages/server/public/flags/LICENSE');
