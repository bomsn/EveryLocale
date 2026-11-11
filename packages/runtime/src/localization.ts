import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CONFIG_FILE, parseAppConfig } from '@everylocale/core/config';
import type { LocaleDefinition } from '@everylocale/core/locales';
import type { CompiledMessages } from './messages.js';
import { loadRelease, type FallbackReport, type Release } from './verified-release.js';

export type LocalizationOptions = {
  /** Path of `everylocale.config.json`. Defaults to the one in the working directory. */
  config?: string;
  /**
   * Serve draft locales as well, for preview deployments. Without it only live locales are
   * served, so incomplete translations never reach the public site.
   */
  drafts?: boolean;
  /** Called once per draft locale with the message ids that fall back to source text. */
  onFallback?: FallbackReport;
};

export type Localization = {
  readonly sourceLocale: string;
  /** Every configured locale, source first, whether served or not. */
  readonly registry: readonly LocaleDefinition[];
  /** The locales this app serves, source first, in display order. */
  readonly locales: readonly LocaleDefinition[];
  readonly release: Release;
  /** Compiled messages of the given namespaces for a served locale. */
  messages(locale: string, namespaces: readonly string[]): CompiledMessages;
};

/** The config and the release disagree, or the config cannot be read. */
export class LocalizationConfigError extends Error {}

/**
 * Reads the app config and its verified release once, for any server framework. Startup fails
 * when the release is missing, altered, for another source locale, or lacks a configured locale.
 */
export async function loadLocalization(options: LocalizationOptions = {}): Promise<Localization> {
  const configPath = resolve(options.config ?? CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch {
    throw new LocalizationConfigError(`No ${CONFIG_FILE} found at ${configPath}`);
  }
  const config = parseAppConfig(JSON.parse(text));
  const release = await loadRelease(resolve(dirname(configPath), config.release.directory), {
    onFallback: options.onFallback,
  });
  if (release.manifest.sourceLocale !== config.sourceLocale)
    throw new LocalizationConfigError(
      `The release is for source locale ${release.manifest.sourceLocale}, the config says ${config.sourceLocale}`,
    );
  const released = new Map(release.manifest.locales.map((item) => [item.id, item.status]));
  const missing = config.registry.slice(1).filter((item) => !released.has(item.id));
  if (missing.length)
    throw new LocalizationConfigError(
      `The release has no ${missing.map((item) => item.id).join(', ')}; run everylocale pull`,
    );
  // A locale the release still marks as draft is served only with drafts enabled, even if the
  // config was switched to live and nobody pulled since.
  const locales = config.registry.filter(
    (item, index) => index === 0 || options.drafts || released.get(item.id) === 'live',
  );
  const served = new Set(locales.map((item) => item.id));
  return {
    sourceLocale: config.sourceLocale,
    registry: config.registry,
    locales,
    release,
    messages(locale, namespaces) {
      if (!served.has(locale))
        throw new LocalizationConfigError(`Locale ${locale} is not served by this app`);
      return release.messages(locale, namespaces);
    },
  };
}
