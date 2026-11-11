import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveRequest } from '@everylocale/adapters';
import { CONFIG_FILE, parseAppConfig } from '@everylocale/core/config';
import {
  localeCookie,
  localeFromPath,
  localizePath,
  type LocaleDefinition,
} from '@everylocale/core/locales';
import { loadRelease, type FallbackReport, type Release } from '@everylocale/runtime/server';
import type { CompiledMessages } from '@everylocale/runtime';
import type { LocaleData } from './shared.js';

export type { LocaleData } from './shared.js';

export type I18nOptions = {
  /** Path of `everylocale.config.json`. Defaults to the one in the working directory. */
  config?: string;
  /** Public origin for canonical and alternate URLs, such as `https://example.com`. */
  origin: string;
  /**
   * Serve draft locales as well, for preview deployments. Without it a draft locale's URLs
   * answer 404, so incomplete translations never reach the public site.
   */
  drafts?: boolean;
  /** Route param that holds the locale prefix, as in `:locale?/about`. Defaults to `locale`. */
  param?: string;
  /** Called once per draft locale with the message ids that fall back to source text. */
  onFallback?: FallbackReport;
};

/** The parts of React Router's loader arguments the adapter reads. */
export type LoaderArgsLike = {
  request: Request;
  params: Readonly<Record<string, string | undefined>>;
};

/**
 * Signed-in pages pass the saved preference; the URL then no longer decides. Every loader of
 * such a page passes the same options, so all of them resolve the same locale.
 */
export type Surface = { privateSurface?: boolean; profileLocale?: string | null };

export type I18n = {
  readonly sourceLocale: string;
  /** The locales this app serves, source first. */
  readonly locales: readonly LocaleDefinition[];
  readonly release: Release;
  /** Locale data for the root loader, with the root route's message namespaces. */
  root(args: LoaderArgsLike, namespaces?: readonly string[], surface?: Surface): LocaleData;
  /** Compiled messages for a route loader: `return { messages: i18n.messages(args, ['checkout']) }`. */
  messages(
    args: LoaderArgsLike,
    namespaces: readonly string[],
    surface?: Surface,
  ): CompiledMessages;
  /** Throws a 404 response when this page has no published variant in the requested locale. */
  requirePublished(args: LoaderArgsLike, published: readonly string[], surface?: Surface): void;
  /**
   * Handles the language form: `?locale=de&path=/about` redirects to `/de/about` and stores the
   * explicit choice in a cookie. Use it as the loader of the form's resource route.
   */
  switchLocale(args: LoaderArgsLike): Response;
};

export class I18nConfigError extends Error {}

const notFound = () => new Response('Not Found', { status: 404, statusText: 'Not Found' });

/**
 * Reads the app config and the verified release once per process. Startup fails when the
 * release is missing, altered, or does not cover every locale the config lists.
 */
export async function createI18n(options: I18nOptions): Promise<I18n> {
  const configPath = resolve(options.config ?? CONFIG_FILE);
  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch {
    throw new I18nConfigError(`No ${CONFIG_FILE} found at ${configPath}`);
  }
  const config = parseAppConfig(JSON.parse(text));
  const release = await loadRelease(resolve(dirname(configPath), config.release.directory), {
    onFallback: options.onFallback,
  });
  if (release.manifest.sourceLocale !== config.sourceLocale)
    throw new I18nConfigError(
      `The release is for source locale ${release.manifest.sourceLocale}, the config says ${config.sourceLocale}`,
    );
  const released = new Map(release.manifest.locales.map((item) => [item.id, item.status]));
  const missing = config.registry.slice(1).filter((item) => !released.has(item.id));
  if (missing.length)
    throw new I18nConfigError(
      `The release has no ${missing.map((item) => item.id).join(', ')}; run everylocale pull`,
    );
  const origin = new URL(options.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search)
    throw new I18nConfigError(
      'origin must be an http or https origin, such as https://example.com',
    );
  const registry = config.registry;
  // A locale the release still marks as draft is served only when drafts are enabled, even if
  // the config was switched to live and nobody pulled since.
  const locales = registry.filter(
    (item, index) => index === 0 || options.drafts || released.get(item.id) === 'live',
  );
  const served = new Set(locales.map((item) => item.id));
  const param = options.param ?? 'locale';

  const resolveArgs = ({ request, params }: LoaderArgsLike, surface: Surface = {}) => {
    const value = params[param];
    const url = new URL(request.url);
    if (value !== undefined) {
      const byPrefix = registry.find((item) => item.prefix && item.prefix === value);
      if (!byPrefix || !served.has(byPrefix.id)) {
        const folded = registry.find(
          (item) => item.prefix && item.prefix === value.toLowerCase() && served.has(item.id),
        );
        // A prefix in other letter case would duplicate the page, so it redirects once.
        if (folded)
          throw new Response(null, {
            status: 308,
            headers: {
              location: `${localizePath(url.pathname, folded.id, registry)}${url.search}`,
            },
          });
        throw notFound();
      }
    } else if (!served.has(localeFromPath(url.pathname, registry).locale)) throw notFound();
    return resolveRequest(request, {
      locales,
      privateSurface: surface.privateSurface,
      profileLocale: surface.profileLocale,
    });
  };

  return {
    sourceLocale: config.sourceLocale,
    locales,
    release,
    root(args, namespaces = [], surface) {
      const resolved = resolveArgs(args, surface);
      return {
        locale: resolved.locale,
        direction: resolved.direction,
        revision: release.revision,
        sourceLocale: config.sourceLocale,
        locales,
        origin: origin.origin,
        pathname: resolved.pathname,
        messages: release.messages(resolved.locale, namespaces),
      };
    },
    messages(args, namespaces, surface) {
      return release.messages(resolveArgs(args, surface).locale, namespaces);
    },
    requirePublished(args, published, surface) {
      if (!published.includes(resolveArgs(args, surface).locale)) throw notFound();
    },
    switchLocale({ request }) {
      const url = new URL(request.url);
      const locale = url.searchParams.get('locale') ?? '';
      const path = url.searchParams.get('path') ?? '/';
      const target = new URL(path, origin);
      if (
        !served.has(locale) ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        target.origin !== origin.origin
      )
        return new Response('Bad Request', { status: 400 });
      return new Response(null, {
        status: 303,
        headers: {
          location: `${localizePath(target.pathname, locale, registry)}${target.search}`,
          'set-cookie': localeCookie(locale, origin.protocol === 'https:'),
        },
      });
    },
  };
}
