import { loadLocalization } from '@everylocale/runtime/server';

/**
 * Loaded once per server process from `everylocale.config.json` in the working directory. The
 * release is verified first, so a missing or altered release fails before any page renders.
 */
export const localization = loadLocalization();

/** Public origin for canonical and alternate links. */
export const ORIGIN = 'https://example.test';
