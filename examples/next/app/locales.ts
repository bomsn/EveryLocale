import { defineLocales } from '@everylocale/core/locales';

/** The app's one locale registry; layouts, pages and controls all read it. */
export const locales = defineLocales('en', [
  'ar',
  { id: 'zh-Hant-TW', prefix: 'zh-tw' },
  'de',
  'es',
  'fr',
]);
