# @everylocale/runtime

## 0.3.0

### Minor Changes

- d56e2e8: The CLI works from `everylocale.config.json`:
  - `sync` uploads every matched source file, withdraws files deleted locally, queues translation for every target locale, and with `--wait` blocks only on live locales.
  - `pull` writes a verified, immutable release with one catalog per locale and namespace, precompiled messages for message namespaces and pinned CLDR plural rules, then renders each translated file in its original format. Draft locales use source text for unapproved messages and skip unapproved documents, and both are reported.
  - `check` verifies the committed release with no network access: live-locale completeness, stale approvals, ICU and plural structure, altered release files, rendered files, and with `--code`, unknown, assembled and unused message ids.
  - `codegen` writes typed message ids and argument types for `@everylocale/runtime`; `--check` fails when the file is stale.
  - `import` sends existing translated files as candidates, and `rollback` activates an earlier verified release.

  The `extract`, `extract-code`, `export` and `render` commands and the unit-file `sync` are replaced by these.

  New package `@everylocale/runtime`: `createFormatter` formats precompiled messages with typed ids and values and reports missing ones, and `@everylocale/runtime/server` loads a release and verifies every file before use.

  Formats declare whether they hold `messages` or `content`. Config file patterns can add `tags` and `frontMatter`, and `formats` loads document format plugins. Documents store their extraction options and origin, and can be removed with `DELETE /projects/{project}/documents/{namespace}`. `GET /projects/{project}/bundle?complete=` names the locales that must be complete.

- 082ca53: `loadLocalization({ config, drafts, onFallback })` from `@everylocale/runtime/server` reads `everylocale.config.json` and its verified release once, for any server framework. It returns the served locales, the full registry and `messages(locale, namespaces)`, and fails at startup when the release is missing, altered or does not cover the config. The React Router adapter's `createI18n` is built on it, and its configuration error is now `LocalizationConfigError`. The Next.js example loads its messages from a release the same way.
- fac451d: `@everylocale/react` formats with `@everylocale/runtime` instead of `react-intl`. `EveryLocaleProvider` takes the request's `locale` and precompiled `messages` (there is no default locale), `Message` and `useMessages().format()` are typed by the generated declarations, and rich-text tags are rendered by functions in `values`. Missing messages are reported once, or throw with `missing: 'throw'`.

  `compileMessage` in core precompiles a message. `@everylocale/runtime/bundler` exports `parserAlias()` so client bundles drop the ICU parser. The React peer range is `>=18.3 <20`.

  Browser entries are measured on every CI run: the runtime adds about 2.8 KB gzipped, the React message bindings about 3.0 KB, and the language controls about 1.3 KB.

### Patch Changes

- 64a1c51: New `@everylocale/react-router` package for React Router 7 and 8 in framework mode. `createI18n({ origin })` reads `everylocale.config.json` and the verified release once per process. `i18n.root(args, namespaces)` resolves the locale in the root loader. Route loaders return `{ messages: i18n.messages(args, namespaces) }`, and `EveryLocaleRouterProvider` merges every matched route's messages, so pages hydrate from the same data the server rendered. A locale prefix that is unknown, or belongs to a draft locale, answers 404. A prefix in other letter case redirects to the canonical one. `requirePublished` answers 404 for pages missing in a locale. `switchLocale` handles a language form that works without JavaScript. `languageMeta(matches)` emits canonical, alternate and `x-default` links, and `formatterOf(matches)` formats titles in `meta` functions. `@everylocale/react-router/vite` keeps the ICU parser out of client bundles.

  The runtime's `Formatter` type is now declared explicitly. Published declarations keep the typed signatures, so generated message types reject an unknown id or a wrong value in apps. In `Message`, rich-text tag renderers receive and return React nodes.

  The workspace sign-in screen is now a `main` landmark.

- Updated dependencies [d56e2e8]
- Updated dependencies [76c7193]
- Updated dependencies [e56753f]
- Updated dependencies [b39b570]
- Updated dependencies [fac451d]
- Updated dependencies [73c9a63]
  - @everylocale/core@0.3.0
