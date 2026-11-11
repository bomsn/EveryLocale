import { createI18n } from '@everylocale/react-router/server';

/**
 * Loaded once per process from `everylocale.config.json` in the working directory; startup
 * fails if the release is missing, altered, or lacks a configured locale.
 */
export const i18n = await createI18n({
  origin: process.env.PUBLIC_ORIGIN ?? 'http://localhost:4316',
});
