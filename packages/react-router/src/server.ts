import { resolveRequest } from '@everylocale/adapters';
import {
  localeCookie,
  localeFromPath,
  localizePath,
  type LocaleDefinition,
} from '@everylocale/core/locales';
import {
  loadLocalization,
  LocalizationConfigError,
  type LocalizationOptions,
  type Release,
} from '@everylocale/runtime/server';
import type { CompiledMessages } from '@everylocale/runtime';
import type { LocaleData } from './shared.js';

export type { LocaleData } from './shared.js';

/** Config, drafts and fallback reporting as for `loadLocalization`; unserved locales answer 404. */
export type I18nOptions = LocalizationOptions & {
  /** Public origin for canonical and alternate URLs, such as `https://example.com`. */
  origin: string;
  /** Route param that holds the locale prefix, as in `:locale?/about`. Defaults to `locale`. */
  param?: string;
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

export { LocalizationConfigError } from '@everylocale/runtime/server';

const notFound = () => new Response('Not Found', { status: 404, statusText: 'Not Found' });

/**
 * Reads the app config and the verified release once per process; see `loadLocalization` for
 * what fails at startup.
 */
export async function createI18n(options: I18nOptions): Promise<I18n> {
  const localization = await loadLocalization(options);
  const origin = new URL(options.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search)
    throw new LocalizationConfigError(
      'origin must be an http or https origin, such as https://example.com',
    );
  const { registry, locales, release, sourceLocale } = localization;
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
    sourceLocale,
    locales,
    release,
    root(args, namespaces = [], surface) {
      const resolved = resolveArgs(args, surface);
      return {
        locale: resolved.locale,
        direction: resolved.direction,
        revision: release.revision,
        sourceLocale,
        locales,
        origin: origin.origin,
        pathname: resolved.pathname,
        messages: localization.messages(resolved.locale, namespaces),
      };
    },
    messages(args, namespaces, surface) {
      return localization.messages(resolveArgs(args, surface).locale, namespaces);
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
