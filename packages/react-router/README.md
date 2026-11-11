# @everylocale/react-router

EveryLocale for React Router 7 and 8 in framework mode. The root loader resolves the locale once, every route loads only the namespaces it uses, and pages hydrate from the same data the server rendered.

```sh
npm install @everylocale/react-router @everylocale/react @everylocale/runtime
```

```ts
// app/i18n.server.ts
import { createI18n } from '@everylocale/react-router/server';
export const i18n = await createI18n({ origin: 'https://example.com' });

// app/root.tsx
export const loader = (args: Route.LoaderArgs) => i18n.root(args, ['app']);

// any route
export const loader = (args: Route.LoaderArgs) => ({ messages: i18n.messages(args, ['checkout']) });
```

Wrap the app in `EveryLocaleRouterProvider`, use `languageMeta(matches)` for canonical and `hreflang` links, and add `everylocale()` from `@everylocale/react-router/vite` to your Vite plugins. Unknown or draft locale prefixes answer 404.

## Documentation

- [Connect your app](https://github.com/bomsn/EveryLocale/blob/develop/docs/CONNECT.md)
- [Runtime integration](https://github.com/bomsn/EveryLocale/blob/develop/docs/INTEGRATION.md)
- [CLI reference](https://github.com/bomsn/EveryLocale/blob/develop/docs/CLI.md)
- [HTTP API](https://github.com/bomsn/EveryLocale/blob/develop/docs/API.md)

EveryLocale is a self-hosted localization toolkit: it translates the text you change, checks every translation with a separate AI review, and delivers only approved translations to your app. MIT licensed.
