# Runtime integration

This guide is for the developer who makes an app display its approved translations. It assumes a release already exists: [Connect your app](CONNECT.md) covers the config file, `sync` and `pull`.

The server decides the language once per request and renders with the messages of that language. The browser receives the same locale and the same messages, so a page never appears in one language and switches during loading. A shared link to `/de/pricing` shows German to everyone. A signed-in dashboard follows the person's saved choice instead.

## Messages and the runtime

`pull` precompiles every message into the release, so browsers format messages without an ICU parser. `@everylocale/runtime` adds about 2.8 KB gzipped to a client bundle.

```ts
import { createFormatter } from '@everylocale/runtime';

const { format } = createFormatter({ locale: 'de', messages });
format('checkout:items', { count: 3 }); // "3 Artikel"
```

`messages` are the compiled messages of the namespaces a page uses. On the server, load them from the release:

```ts
import { loadLocalization } from '@everylocale/runtime/server';

// Once per process. Fails if the release is missing, altered or does not cover the config.
const localization = await loadLocalization();
const messages = localization.messages('de', ['checkout']);
```

`localization.locales` lists the locales the app serves: the source locale and every live locale. Pass `drafts: true` to serve draft locales as well, for example on a preview deployment. Draft messages that are not approved yet use the source text, and `onFallback` is called once per draft locale with the ids concerned.

A message id that is not in `messages` renders as the id and is reported once per locale through `onMissing` (by default `console.error`). Pass `missing: 'throw'` in tests and builds to fail instead.

### Typed message ids

`everylocale codegen` writes a declaration file that registers every message id and its arguments with TypeScript. With it in your project, `format('checkout:itms')` and `format('checkout:items', { count: 'three' })` are compile errors, and a message with rich-text tags requires a renderer for each tag. Run `everylocale codegen --check` in CI so the file stays current.

### Keep the parser out of client bundles

Client bundles format precompiled messages only, so they can replace FormatJS's parser with its parser-free build:

- **Vite** (including React Router): add `everylocale()` from `@everylocale/react-router/vite` to `plugins`.
- **webpack** (including Next.js): add `parserAlias()` from `@everylocale/runtime/bundler` to `resolve.alias` for client builds.

Server code keeps the parser.

## React

`@everylocale/react` works with React 18.3 and 19.

```tsx
import { EveryLocaleProvider, Message, useMessages } from '@everylocale/react';

<EveryLocaleProvider locale={locale} messages={messages}>
  <Checkout />
</EveryLocaleProvider>;

function Checkout() {
  const { format } = useMessages();
  return (
    <>
      <h1>{format('checkout:title')}</h1>
      <Message id="checkout:terms" values={{ link: (chunks) => <a href="/terms">{chunks}</a> }} />
    </>
  );
}
```

There is no default locale: the provider takes the locale the server resolved. `Message` renders rich text. Each tag in the message, such as `<link>terms</link>`, is rendered by the function of the same name in `values`, which receives the formatted content as React nodes.

### Language controls

The controls contain no built-in text. Pass every label from your own messages.

- `LanguageLinks` renders a navigation landmark linking to each published counterpart of the page, with `hreflang` and `lang`. It works without JavaScript and is crawlable. Pass `links`, the URL of the page in each locale; locales without a link are left out.
- `LanguageSelect` is a labelled select in a GET form with a submit button, so moving through the options with a keyboard never navigates away. Your server handles the submitted locale, stores the explicit choice and redirects. Pass `onSelect` to handle the choice in the browser instead.
- `LanguageSuggestion` offers the visitor's browser language once, after hydration, if the app serves it. The host passes `dismissed`, `onAccept` and `onDismiss`, and decides where a dismissal is remembered. `labels` provides the region name, the dismiss label, and `prompt(language)` and `accept(language)` renderers.
- `LocaleFlag` shows a flag only for flags you import, such as `import tw from '@everylocale/react/flags/tw'`, so a page bundles only those. It uses the locale's region, then a trusted visitor `country`, then the language's likely region. Flags stand for countries, not languages; prefer language names alone where a flag could be misread.

## React Router

`@everylocale/react-router` supports React Router 7 and 8 in framework mode. Put every localized route under an optional locale segment:

```ts
// app/routes.ts
export default [
  ...prefix(':locale?', [index('routes/home.tsx'), route('about', 'routes/about.tsx')]),
  route('language', 'routes/language.ts'),
] satisfies RouteConfig;
```

```ts
// app/i18n.server.ts
import { createI18n } from '@everylocale/react-router/server';

export const i18n = await createI18n({ origin: 'https://example.com' });
```

```tsx
// app/root.tsx
export const loader = (args: Route.LoaderArgs) => i18n.root(args, ['app']);

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root');
  return (
    <html lang={data?.locale ?? 'en'} dir={data?.direction ?? 'ltr'}>
      {/* head, body, Scripts */}
    </html>
  );
}

export default function App() {
  return (
    <EveryLocaleRouterProvider>
      <Outlet />
    </EveryLocaleRouterProvider>
  );
}
```

```tsx
// app/routes/about.tsx
export const loader = (args: Route.LoaderArgs) => ({ messages: i18n.messages(args, ['about']) });

export const meta: Route.MetaFunction = ({ matches }) => [
  { title: formatterOf(matches)?.format('about:heading') },
  ...languageMeta(matches),
];
```

- `i18n.root(args, namespaces)` resolves the locale and returns it with its direction, the served locales, the release revision and the root route's messages. `EveryLocaleRouterProvider` merges the messages of every matched route, and client navigation brings each route's namespaces with its data.
- An unknown locale prefix, or the prefix of a draft locale the app does not serve, answers 404. A prefix in other letter case, such as `/DE/about`, redirects to `/de/about`.
- `i18n.requirePublished(args, ['en', 'de'])` answers 404 when a page exists only in some locales, instead of showing source text under a foreign URL.
- `i18n.switchLocale(args)` is the loader of the language form's route. It redirects `?locale=de&path=/about` to `/de/about` and stores the choice in the `el_locale` cookie. It refuses unknown locales and paths outside the site.
- `languageMeta(matches)` returns canonical, reciprocal alternate and `x-default` links. A route's `meta` replaces its parents', so every route that exports `meta` includes them. `formatterOf(matches)` formats titles there, since `meta` cannot use hooks.
- `useLocaleData()`, `useLocalizedPath()` (maps `/about` to `/de/about` for the current locale) and `languagePaths(data)` build navigation and language links.

Signed-in pages pass `{ privateSurface: true, profileLocale }` as the last argument of `root`, `messages` and `requirePublished`. The saved preference then decides, followed by the explicit cookie and the source locale. Every loader of such a page passes the same options.

`examples/react-router` is a complete app in six languages, tested in Chromium for server HTML, hydration, plurals, navigation, language links and accessibility.

## Next.js

`examples/next` is an App Router app. Its optional catch-all route keeps the source locale unprefixed. The layout and page resolve the locale from the path with `resolveRequest(request, { locales })`, where `locales` comes from `loadLocalization()`. They render `lang` and `dir`, and pass the page's messages to `EveryLocaleProvider`. `generateMetadata` uses `nextMetadata(origin, paths, locale, sourceLocale)` for canonical and alternate links from the same paths the page links to.

`next.config.mjs` lists `@everylocale/runtime` and `@everylocale/core` in `serverExternalPackages`, so release loading runs in Node unbundled. It applies `parserAlias()` to client builds.

Do not redirect by geography or browser language. Offer `LanguageSuggestion` and a language selector instead.

## Locale rules

`resolveRequest(request, { locales, privateSurface, profileLocale })` from `@everylocale/adapters` accepts any Fetch API `Request`. Public pages take the locale from the URL prefix. Private surfaces use the saved profile preference, then the `el_locale` cookie, then the source locale. Country, currency and time zone are never inputs: keep them separate from language in your own code too.

Locale ids are BCP 47. Native names, direction, likely scripts and plural rules come from the Unicode CLDR data in Node.js and browsers. `matchLocale` matches a preference to the closest served locale, and never matches a Simplified Chinese preference to Traditional Chinese.

For right-to-left languages, set `dir` on the document and use logical CSS properties such as `margin-inline-start`. Wrap mixed-direction identifiers in `<bdi>`.

## Arabic and Taiwan Chinese fonts

Import `@everylocale/react/fonts.css` for optional, self-hosted Noto Sans Arabic and Noto Sans TC. Set `lang` to `ar` or `zh-Hant-TW` on the document or element. The full Taiwan font is about 5.4 MB, and the browser downloads it only for elements that use it. You can supply your own appropriately licensed fonts or subsets instead. Font licenses ship beside the assets.

For PDF reports generated in a browser, load the fonts and wait for `document.fonts.ready` before exporting. Keep `lang`, `dir`, logical layout and `<bdi>` in the report template. A native PDF renderer needs an Arabic shaping and bidirectional engine; font coverage alone does not shape text.

## Publication and search

For translated pages and articles, record each published variant: page id, locale, path, approved revision and localized title. `PublishedRegistry(origin, pages, locales)` builds one immutable snapshot from those records. Its methods use that same snapshot:

- `resolve(path)` finds the page and locale for a path; `null` means 404.
- `switch(pageId, locale)` and `paths(pageId)` give language links; `original(pageId)` links to the source-language page.
- `metadata(pageId, locale)` gives canonical and alternate links, with `x-default` on the source.
- `structuredData(pageId, locale, data)` adds the URL, language, title and description to your structured data.
- `sitemap()` lists every published variant with its alternates.
- `link(href, locale)` rewrites an internal link to its published counterpart, keeping query strings and anchors.

Build the registry from your approved release, never from pending work. Swap the whole snapshot when a new release is published.

For approved HTML or Gutenberg content, `rewriteHtmlLinks(content, (href) => registry.link(href, locale))` changes only link destinations, leaving block comments, code and markup intact. The WordPress connector does the same when it renders articles.

## Other servers

`EveryLocaleClient(baseUrl, token)` from `@everylocale/adapters` is a small server-side client for the [HTTP API](API.md). Any stack can call the API or use the files `pull` renders.

Load a new release into a fresh map and switch the serving reference atomically; keep the previous map for rollback. Never store the current locale in shared mutable state. Cache keys for rendered pages include the locale and the release revision.

## Extension points

- **Document formats.** A format is a default export `{ id, kind: 'messages' | 'content', extract }`. List its package in the config's `formats` and use its `id` in `files`.
- **Model providers.** Any OpenAI-compatible endpoint works through configuration; see [Configuration](CONFIGURATION.md). Another vendor needs a transport that implements the same call and cost reservation contract.
- **Storage.** `TranslationStore` is the engine's storage interface and `LocalizationStore` adds projects, review, documents and tokens. An implementation must keep the transactional approval, lease, idempotency and budget guarantees.
