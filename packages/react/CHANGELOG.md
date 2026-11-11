# @everylocale/react

## 0.3.0

### Minor Changes

- e56753f: Locales come from a registry the app defines with `defineLocales(source, targets)`; there is no built-in language list. Labels default to each language's own CLDR name, direction to its script, and URL prefixes to the lower-cased id. Every helper that resolves or localizes a path takes the registry, and `nextMetadata` and `alternates` take the source locale.

  `everylocale.config.json` describes an app: its project, source and target locales with `live` or `draft` status, file patterns with `{locale}` and `{namespace}`, and the release directory. `parseAppConfig` validates it and reports every problem with its location, and `@everylocale/core/schema/config-1.json` is its JSON Schema for editors.

  Projects have a `reviewerLanguage`, the language AI review findings are written in.

  `LanguageSelector` is replaced by `LanguageLinks`, crawlable links to each published counterpart, and `LanguageSelect`, a form that changes language only on submit. Flags are opt-in per country from `@everylocale/react/flags/<code>`, and `LocaleFlag` takes the imported flags.

- fac451d: `@everylocale/react` formats with `@everylocale/runtime` instead of `react-intl`. `EveryLocaleProvider` takes the request's `locale` and precompiled `messages` (there is no default locale), `Message` and `useMessages().format()` are typed by the generated declarations, and rich-text tags are rendered by functions in `values`. Missing messages are reported once, or throw with `missing: 'throw'`.

  `compileMessage` in core precompiles a message. `@everylocale/runtime/bundler` exports `parserAlias()` so client bundles drop the ICU parser. The React peer range is `>=18.3 <20`.

  Browser entries are measured on every CI run: the runtime adds about 2.8 KB gzipped, the React message bindings about 3.0 KB, and the language controls about 1.3 KB.

- 73c9a63: Document formats now live behind one registry. `registerFormat()` adds a format from another package, and `formatIds()` lists the available ones. HTML always extracts whole sentences with protected inline markup.

  Markdown and MDX front matter is parsed as YAML. Only the keys listed in the `frontMatter` option are translated (`title` and `description` by default), and every other key is copied unchanged.

  Markdown, MDX and HTML segment ids are derived from content, so inserting a paragraph adds one segment and leaves the others' approvals intact. The first import after upgrading re-keys existing documents once.

  Traditional Chinese script checks apply to every locale whose likely script is Traditional Han, including `zh-TW`, `zh-HK` and `zh-Hant`. Model instructions describe the target language from its locale id instead of naming specific languages.

  `extract-code` no longer stores file paths in message context, so source revisions match across checkouts. A declaration whose id, default message or description is not a string literal fails with its file and line.

  `LanguageSuggestion` takes `dismissed`, `onAccept`, `onDismiss` and required `labels` from the host and no longer stores anything in the browser.

  The Remix 2 helper `remixMeta` is removed. Use `PublishedRegistry.metadata()` or the framework adapter for your router.

### Patch Changes

- 64a1c51: New `@everylocale/react-router` package for React Router 7 and 8 in framework mode. `createI18n({ origin })` reads `everylocale.config.json` and the verified release once per process. `i18n.root(args, namespaces)` resolves the locale in the root loader. Route loaders return `{ messages: i18n.messages(args, namespaces) }`, and `EveryLocaleRouterProvider` merges every matched route's messages, so pages hydrate from the same data the server rendered. A locale prefix that is unknown, or belongs to a draft locale, answers 404. A prefix in other letter case redirects to the canonical one. `requirePublished` answers 404 for pages missing in a locale. `switchLocale` handles a language form that works without JavaScript. `languageMeta(matches)` emits canonical, alternate and `x-default` links, and `formatterOf(matches)` formats titles in `meta` functions. `@everylocale/react-router/vite` keeps the ICU parser out of client bundles.

  The runtime's `Formatter` type is now declared explicitly. Published declarations keep the typed signatures, so generated message types reject an unknown id or a wrong value in apps. In `Message`, rich-text tag renderers receive and return React nodes.

  The workspace sign-in screen is now a `main` landmark.

- Updated dependencies [d56e2e8]
- Updated dependencies [082ca53]
- Updated dependencies [fac451d]
- Updated dependencies [64a1c51]
  - @everylocale/runtime@0.3.0
