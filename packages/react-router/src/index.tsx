import { useCallback, useMemo, type ReactNode } from 'react';
import { useMatches } from 'react-router';
import { EveryLocaleProvider } from '@everylocale/react';
import {
  createFormatter,
  localizePath,
  type CompiledMessage,
  type Formatter,
  type MissingMessageHandler,
} from '@everylocale/runtime';
import { localeDataOf, languageLinkTags, type LocaleData, type Matches } from './shared.js';

export {
  languagePaths,
  localeDataOf,
  type LocaleData,
  type MatchLike,
  type Matches,
} from './shared.js';

const routeMessages = (data: unknown) =>
  typeof data === 'object' && data !== null && 'messages' in data
    ? (data.messages as Readonly<Record<string, CompiledMessage>>)
    : undefined;

/** Every matched route's messages merged in route order, root first. */
const mergedMessages = (matches: Matches) =>
  Object.assign({}, ...matches.map((match) => routeMessages(match?.loaderData))) as Readonly<
    Record<string, CompiledMessage>
  >;

/**
 * Provides formatting for the locale the root loader resolved, with the messages of every
 * matched route merged in route order. Routes return `{ messages: i18n.messages(...) }` from
 * their loaders, so client navigation brings each page's namespaces with its data.
 *
 * Without root locale data, for example while an error boundary renders after the root loader
 * threw, children render without a provider.
 */
export function EveryLocaleRouterProvider({
  children,
  missing,
  onMissing,
}: {
  children: ReactNode;
  missing?: 'report' | 'throw';
  onMissing?: MissingMessageHandler;
}) {
  const matches = useMatches();
  const root = localeDataOf(matches);
  // React Router keeps the matches array stable until navigation or revalidation changes the
  // matched routes or their loader data, so the formatter is rebuilt only then.
  const messages = useMemo(() => mergedMessages(matches), [matches]);
  if (!root) return <>{children}</>;
  return (
    <EveryLocaleProvider
      locale={root.locale}
      messages={messages}
      missing={missing}
      onMissing={onMissing}
    >
      {children}
    </EveryLocaleProvider>
  );
}

/** The root loader's locale data, or undefined while an error boundary replaces the root. */
export function useLocaleData(): LocaleData | undefined {
  return localeDataOf(useMatches());
}

/**
 * Meta descriptors for canonical and alternate links. A route's `meta` replaces its parents',
 * so each route that exports `meta` spreads these in: `[...languageMeta(matches), { title }]`.
 */
export function languageMeta(matches: Matches, published?: readonly string[]) {
  const data = localeDataOf(matches);
  return data ? languageLinkTags(data, published) : [];
}

/** Maps a path without prefix to the current locale's URL: `/about` becomes `/de/about`. */
export function useLocalizedPath(): (path: string) => string {
  const data = useLocaleData();
  return useCallback(
    (path: string) => (data ? localizePath(path, data.locale, data.locales) : path),
    [data],
  );
}

/**
 * A formatter for `meta` functions, which cannot use hooks: the root locale with the messages
 * of every matched route. Undefined while an error boundary replaces the root.
 */
export function formatterOf(matches: Matches): Formatter | undefined {
  const data = localeDataOf(matches);
  return data && createFormatter({ locale: data.locale, messages: mergedMessages(matches) });
}
