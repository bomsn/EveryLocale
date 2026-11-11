# @everylocale/react-router

## 0.3.0

### Minor Changes

- 082ca53: `loadLocalization({ config, drafts, onFallback })` from `@everylocale/runtime/server` reads `everylocale.config.json` and its verified release once, for any server framework. It returns the served locales, the full registry and `messages(locale, namespaces)`, and fails at startup when the release is missing, altered or does not cover the config. The React Router adapter's `createI18n` is built on it, and its configuration error is now `LocalizationConfigError`. The Next.js example loads its messages from a release the same way.
- 64a1c51: New `@everylocale/react-router` package for React Router 7 and 8 in framework mode. `createI18n({ origin })` reads `everylocale.config.json` and the verified release once per process. `i18n.root(args, namespaces)` resolves the locale in the root loader. Route loaders return `{ messages: i18n.messages(args, namespaces) }`, and `EveryLocaleRouterProvider` merges every matched route's messages, so pages hydrate from the same data the server rendered. A locale prefix that is unknown, or belongs to a draft locale, answers 404. A prefix in other letter case redirects to the canonical one. `requirePublished` answers 404 for pages missing in a locale. `switchLocale` handles a language form that works without JavaScript. `languageMeta(matches)` emits canonical, alternate and `x-default` links, and `formatterOf(matches)` formats titles in `meta` functions. `@everylocale/react-router/vite` keeps the ICU parser out of client bundles.

  The runtime's `Formatter` type is now declared explicitly. Published declarations keep the typed signatures, so generated message types reject an unknown id or a wrong value in apps. In `Message`, rich-text tag renderers receive and return React nodes.

  The workspace sign-in screen is now a `main` landmark.

### Patch Changes

- Updated dependencies [d56e2e8]
- Updated dependencies [76c7193]
- Updated dependencies [082ca53]
- Updated dependencies [e56753f]
- Updated dependencies [b39b570]
- Updated dependencies [fac451d]
- Updated dependencies [64a1c51]
- Updated dependencies [73c9a63]
  - @everylocale/runtime@0.3.0
  - @everylocale/core@0.3.0
  - @everylocale/react@0.3.0
  - @everylocale/adapters@0.3.0
