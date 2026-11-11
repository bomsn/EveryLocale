import {
  alternates,
  localizePath,
  type CompiledMessages,
  type LocaleDefinition,
} from '@everylocale/runtime';

/**
 * What the root loader returns. The server decides the locale once per request; the browser
 * hydrates from this same data, so it never makes a second language decision.
 */
export type LocaleData = {
  locale: string;
  direction: 'ltr' | 'rtl';
  /** The release revision the messages came from. */
  revision: string;
  sourceLocale: string;
  /** The locales this app serves, source first, in display order. */
  locales: readonly LocaleDefinition[];
  /** The configured public origin, used for canonical and alternate URLs. */
  origin: string;
  /** The request path without its locale prefix. */
  pathname: string;
  /** Compiled messages for the namespaces the root route asked for. */
  messages: CompiledMessages;
};

/** Anything route matches expose: React Router's `UIMatch` and `MetaMatch` both fit. */
export type MatchLike = { readonly loaderData?: unknown };
/** Route matches as hooks and `meta` functions receive them; typed meta matches may hold gaps. */
export type Matches = readonly (MatchLike | undefined)[];

/** The first match is always the root route, whose loader returned `i18n.root()`. */
export function localeDataOf(matches: Matches): LocaleData | undefined {
  const data = matches[0]?.loaderData;
  if (typeof data !== 'object' || data === null) return undefined;
  return 'locale' in data && 'locales' in data && 'messages' in data
    ? (data as LocaleData)
    : undefined;
}

/**
 * The path of the current page in each served locale. Pass `published` when a page exists in
 * only some locales, so no link points at a page that would answer 404.
 */
export function languagePaths(
  data: LocaleData,
  published?: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    data.locales
      .filter((item) => !published || published.includes(item.id))
      .map((item) => [item.id, localizePath(data.pathname, item.id, data.locales)]),
  );
}

/** Canonical and reciprocal alternate links, with `x-default` pointing at the source locale. */
export function languageLinkTags(data: LocaleData, published?: readonly string[]) {
  const paths = languagePaths(data, published);
  const canonical = paths[data.locale];
  return [
    ...(canonical
      ? [{ tagName: 'link' as const, rel: 'canonical', href: new URL(canonical, data.origin).href }]
      : []),
    ...alternates(data.origin, paths, data.sourceLocale).map((item) => ({
      tagName: 'link' as const,
      rel: 'alternate',
      hrefLang: item.hreflang,
      href: item.href,
    })),
  ];
}
