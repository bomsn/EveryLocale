import type { Plugin } from 'vite';
import { parserAlias } from '@everylocale/runtime/bundler';

/**
 * Release messages arrive precompiled, so client bundles swap the ICU parser for FormatJS's
 * parser-free build. Server bundles keep the parser, which the CLI and tests use to compile.
 */
export function everylocale(): Plugin {
  const aliases = Object.entries(parserAlias());
  return {
    name: 'everylocale:precompiled-messages',
    enforce: 'pre',
    applyToEnvironment: (environment) => environment.config.consumer === 'client',
    resolveId(source) {
      return aliases.find(([specifier]) => specifier === source)?.[1] ?? null;
    },
  };
}
