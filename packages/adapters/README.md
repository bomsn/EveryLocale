# @everylocale/adapters

Server-side helpers for any framework that hands you a Fetch API `Request`.

```sh
npm install @everylocale/adapters
```

- `resolveRequest(request, { locales })` gives the locale and direction for a request: the URL on public pages, the saved preference on private ones.
- `nextMetadata(origin, paths, locale, sourceLocale)` returns Next.js canonical and alternate links.
- `PublishedRegistry` keeps routing, language links, SEO metadata and the sitemap consistent with what is actually published.
- `EveryLocaleClient` is a small server-side client for the EveryLocale HTTP API.

## Documentation

- [Connect your app](https://github.com/bomsn/EveryLocale/blob/develop/docs/CONNECT.md)
- [Runtime integration](https://github.com/bomsn/EveryLocale/blob/develop/docs/INTEGRATION.md)
- [CLI reference](https://github.com/bomsn/EveryLocale/blob/develop/docs/CLI.md)
- [HTTP API](https://github.com/bomsn/EveryLocale/blob/develop/docs/API.md)

EveryLocale is a self-hosted localization toolkit: it translates the text you change, checks every translation with a separate AI review, and delivers only approved translations to your app. MIT licensed.
