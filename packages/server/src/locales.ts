import { defineLocales, flagCountry, type LocaleDefinition } from '@everylocale/core';

/**
 * One-click choices when creating a project in the workspace. Any other BCP 47 id can be
 * typed; nothing else in the service treats these locales differently.
 */
const SUGGESTED = [
  'en',
  'ar',
  'cs',
  'da',
  'de',
  'es',
  'es-419',
  'fi',
  'fr',
  'fr-CA',
  'he',
  'hi',
  'id',
  'it',
  'ja',
  'ko',
  'nb',
  'nl',
  'pl',
  'pt-BR',
  'pt-PT',
  'ru',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh-CN',
  'zh-TW',
] as const;

export type WorkspaceLocale = LocaleDefinition & { flag: string | null };
const withFlag = (item: LocaleDefinition): WorkspaceLocale => ({
  ...item,
  flag: flagCountry(item.id)?.toLowerCase() ?? null,
});
export const suggestedLocales = (): WorkspaceLocale[] =>
  defineLocales(SUGGESTED[0], SUGGESTED.slice(1)).map(withFlag);
export const projectLocales = (source: string, targets: readonly string[]): WorkspaceLocale[] =>
  defineLocales(source, targets).map(withFlag);
