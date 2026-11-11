import { fileURLToPath } from 'node:url';

/**
 * Messages from a release are precompiled, so client bundles can replace the ICU parser with
 * FormatJS's parser-free build. Use in a bundler config, for example Vite's `resolve.alias` or
 * webpack's `resolve.alias` for client builds. A string message reaching the parser-free build
 * throws, which the runtime never does with release messages.
 */
export function parserAlias(): Record<string, string> {
  return {
    '@formatjs/icu-messageformat-parser': fileURLToPath(
      import.meta.resolve('@formatjs/icu-messageformat-parser/no-parser.js'),
    ),
  };
}
