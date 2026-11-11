---
'@everylocale/react-router': minor
'@everylocale/runtime': patch
'@everylocale/react': patch
'@everylocale/server': patch
---

New `@everylocale/react-router` package for React Router 7 and 8 in framework mode. `createI18n({ origin })` reads `everylocale.config.json` and the verified release once per process. `i18n.root(args, namespaces)` resolves the locale in the root loader. Route loaders return `{ messages: i18n.messages(args, namespaces) }`, and `EveryLocaleRouterProvider` merges every matched route's messages, so pages hydrate from the same data the server rendered. A locale prefix that is unknown, or belongs to a draft locale, answers 404. A prefix in other letter case redirects to the canonical one. `requirePublished` answers 404 for pages missing in a locale. `switchLocale` handles a language form that works without JavaScript. `languageMeta(matches)` emits canonical, alternate and `x-default` links, and `formatterOf(matches)` formats titles in `meta` functions. `@everylocale/react-router/vite` keeps the ICU parser out of client bundles.

The runtime's `Formatter` type is now declared explicitly. Published declarations keep the typed signatures, so generated message types reject an unknown id or a wrong value in apps. In `Message`, rich-text tag renderers receive and return React nodes.

The workspace sign-in screen is now a `main` landmark.
