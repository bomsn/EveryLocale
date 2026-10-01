import {
  alternates,
  localizePath,
  localeFromPath,
  resolveLocale,
  readLocaleCookie,
  type LocaleDefinition,
  DEFAULT_LOCALES,
} from '@everylocale/core/locales';
import type { ApprovedCatalog } from '@everylocale/core/types';
export { PublishedRegistry, type PublishedPage, type PublishedVariant } from './published.js';

export type AdapterOptions = {
  locales?: readonly LocaleDefinition[];
  profileLocale?: string | null;
  privateSurface?: boolean;
};
/** Works with a Remix 2 loader's Request and a Next.js server Request alike. */
export function resolveRequest(request: Request, options: AdapterOptions = {}) {
  const url = new URL(request.url);
  const locales = options.locales ?? DEFAULT_LOCALES;
  const locale = resolveLocale({
    pathname: url.pathname,
    privateSurface: options.privateSurface ?? false,
    profile: options.profileLocale,
    cookie: readLocaleCookie(request.headers.get('cookie')),
    locales,
  });
  const definition = locales.find((x) => x.id === locale)!;
  return {
    locale,
    direction: definition.direction,
    pathname: localeFromPath(url.pathname, locales).pathname,
  };
}
export function remixMeta(origin: string, paths: Record<string, string>, locale: string) {
  const path = paths[locale];
  if (!path) throw new Error('Requested page translation is unpublished');
  return [
    { tagName: 'link', rel: 'canonical', href: new URL(path, origin).href },
    ...alternates(origin, paths).map((x) => ({
      tagName: 'link',
      rel: 'alternate',
      hrefLang: x.hreflang,
      href: x.href,
    })),
  ];
}
export function nextMetadata(origin: string, paths: Record<string, string>, locale: string) {
  const path = paths[locale];
  if (!path) throw new Error('Requested page translation is unpublished');
  return {
    alternates: {
      canonical: new URL(path, origin).href,
      languages: Object.fromEntries(alternates(origin, paths).map((x) => [x.hreflang, x.href])),
    },
  };
}
export function switchPage(
  path: string,
  locale: string,
  availablePaths?: Record<string, string>,
): string | null {
  if (availablePaths) return availablePaths[locale] ?? null;
  return localizePath(path, locale);
}
export class EveryLocaleClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid service URL');
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
