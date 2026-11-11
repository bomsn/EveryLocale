import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Code, documentation and interface copy use plain ASCII quotes and hyphens: curly quotes and
 * long dashes break copied commands and read inconsistently. Translated catalogs, fixtures that
 * test typography, and third-party notices may use them, so they are exempt.
 */
const FORBIDDEN = new RegExp(
  `[${[0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014].map((code) => String.fromCodePoint(code)).join('')}]`,
  'u',
);
const TEXT = /\.(?:md|ts|tsx|js|mjs|cjs|json|ya?ml|css|html|php|txt|sql)$/;
const EXEMPT = [
  /^examples\/[^/]+\/locales\//,
  /^tests\/fixtures\//,
  /(?:^|\/)fonts\//,
  /(?:^|\/)LICENSE/,
  /^pnpm-lock\.yaml$/,
];
/** Tests that deliberately feed typographic punctuation through parsers and validators. */
const TYPOGRAPHY_TESTS = new Set(['tests/core.test.ts', 'tests/parser-corpus.test.ts']);

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((path) => TEXT.test(path) && !EXEMPT.some((pattern) => pattern.test(path)))
  .filter((path) => !TYPOGRAPHY_TESTS.has(path));

const problems: string[] = [];
for (const path of files) {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    // Listed by git but deleted in the working tree; nothing to check.
    continue;
  }
  text.split('\n').forEach((line, index) => {
    const match = FORBIDDEN.exec(line);
    if (match)
      problems.push(
        `${path}:${String(index + 1)}: U+${match[0].codePointAt(0)?.toString(16).toUpperCase() ?? ''} ${line.trim().slice(0, 100)}`,
      );
  });
}
if (problems.length) {
  console.error(
    `Use plain quotes and hyphens instead of curly quotes and long dashes:\n${problems.join('\n')}`,
  );
  process.exitCode = 1;
} else console.log(`Punctuation: ${String(files.length)} files use plain quotes and hyphens.`);
