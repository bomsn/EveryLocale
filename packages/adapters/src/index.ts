import {
  alternates,
  localizePath,
  localeFromPath,
  resolveLocale,
  readLocaleCookie,
  type LocaleDefinition,
} from '@everylocale/core/locales';
import type { ApprovedCatalog } from '@everylocale/core/types';
import { serviceUrl } from '@everylocale/core/service-url';
export { PublishedRegistry, type PublishedPage, type PublishedVariant } from './published.js';

export type AdapterOptions = {
  /** The registry from `defineLocales` or the app config; the first entry is the source locale. */
  locales: readonly LocaleDefinition[];
  profileLocale?: string | null;
  privateSurface?: boolean;
};
/** Accepts any Fetch API Request, as server frameworks pass to loaders and route handlers. */
export function resolveRequest(request: Request, options: AdapterOptions) {
  const url = new URL(request.url);
  const { locales } = options;
  const locale = resolveLocale({
    pathname: url.pathname,
    privateSurface: options.privateSurface ?? false,
    profile: options.profileLocale,
    cookie: readLocaleCookie(request.headers.get('cookie')),
    locales,
  });
  const definition = locales.find((x) => x.id === locale);
  if (!definition) throw new Error(`Locale ${locale} is not in the configured registry`);
  return {
    locale,
    direction: definition.direction,
    pathname: localeFromPath(url.pathname, locales).pathname,
  };
}
export function nextMetadata(
  origin: string,
  paths: Readonly<Record<string, string>>,
  locale: string,
  sourceLocale: string,
) {
  const path = paths[locale];
  if (!path) throw new Error('Requested page translation is unpublished');
  return {
    alternates: {
      canonical: new URL(path, origin).href,
      languages: Object.fromEntries(
        alternates(origin, paths, sourceLocale).map((x) => [x.hreflang, x.href]),
      ),
    },
  };
}
/** The published counterpart when paths are known, otherwise the same path under the locale's prefix. */
export function switchPage(
  path: string,
  locale: string,
  locales: readonly LocaleDefinition[],
  availablePaths?: Readonly<Record<string, string>>,
): string | null {
  if (availablePaths) return availablePaths[locale] ?? null;
  return localizePath(path, locale, locales);
}
export class EveryLocaleClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = serviceUrl(baseUrl);
  }
  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/api/v1${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`EveryLocale returned HTTP ${response.status}`);
    return (await response.json()) as T;
  }
  catalog(project: string, locale: string, requireCurrent = true): Promise<ApprovedCatalog> {
    return this.request(
      `/projects/${encodeURIComponent(project)}/exports/${encodeURIComponent(locale)}?current=${requireCurrent ? 'true' : 'false'}`,
    );
  }
}
