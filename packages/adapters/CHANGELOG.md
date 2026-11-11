# @everylocale/adapters

## 0.3.0

### Minor Changes

- e56753f: Locales come from a registry the app defines with `defineLocales(source, targets)`; there is no built-in language list. Labels default to each language's own CLDR name, direction to its script, and URL prefixes to the lower-cased id. Every helper that resolves or localizes a path takes the registry, and `nextMetadata` and `alternates` take the source locale.

  `everylocale.config.json` describes an app: its project, source and target locales with `live` or `draft` status, file patterns with `{locale}` and `{namespace}`, and the release directory. `parseAppConfig` validates it and reports every problem with its location, and `@everylocale/core/schema/config-1.json` is its JSON Schema for editors.

  Projects have a `reviewerLanguage`, the language AI review findings are written in.

  `LanguageSelector` is replaced by `LanguageLinks`, crawlable links to each published counterpart, and `LanguageSelect`, a form that changes language only on submit. Flags are opt-in per country from `@everylocale/react/flags/<code>`, and `LocaleFlag` takes the imported flags.

- 73c9a63: Document formats now live behind one registry. `registerFormat()` adds a format from another package, and `formatIds()` lists the available ones. HTML always extracts whole sentences with protected inline markup.

  Markdown and MDX front matter is parsed as YAML. Only the keys listed in the `frontMatter` option are translated (`title` and `description` by default), and every other key is copied unchanged.

  Markdown, MDX and HTML segment ids are derived from content, so inserting a paragraph adds one segment and leaves the others' approvals intact. The first import after upgrading re-keys existing documents once.

  Traditional Chinese script checks apply to every locale whose likely script is Traditional Han, including `zh-TW`, `zh-HK` and `zh-Hant`. Model instructions describe the target language from its locale id instead of naming specific languages.

  `extract-code` no longer stores file paths in message context, so source revisions match across checkouts. A declaration whose id, default message or description is not a string literal fails with its file and line.

  `LanguageSuggestion` takes `dismissed`, `onAccept`, `onDismiss` and required `labels` from the host and no longer stores anything in the browser.

  The Remix 2 helper `remixMeta` is removed. Use `PublishedRegistry.metadata()` or the framework adapter for your router.

### Patch Changes

- Updated dependencies [d56e2e8]
- Updated dependencies [76c7193]
- Updated dependencies [e56753f]
- Updated dependencies [b39b570]
- Updated dependencies [fac451d]
- Updated dependencies [73c9a63]
  - @everylocale/core@0.3.0
