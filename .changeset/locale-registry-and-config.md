---
'@everylocale/core': minor
'@everylocale/react': minor
'@everylocale/adapters': minor
'@everylocale/server': minor
---

Locales come from a registry the app defines with `defineLocales(source, targets)`; there is no built-in language list. Labels default to each language's own CLDR name, direction to its script, and URL prefixes to the lower-cased id. Every helper that resolves or localizes a path takes the registry, and `nextMetadata` and `alternates` take the source locale.

`everylocale.config.json` describes an app: its project, source and target locales with `live` or `draft` status, file patterns with `{locale}` and `{namespace}`, and the release directory. `parseAppConfig` validates it and reports every problem with its location, and `@everylocale/core/schema/config-1.json` is its JSON Schema for editors.

Projects have a `reviewerLanguage`, the language AI review findings are written in.

`LanguageSelector` is replaced by `LanguageLinks`, crawlable links to each published counterpart, and `LanguageSelect`, a form that changes language only on submit. Flags are opt-in per country from `@everylocale/react/flags/<code>`, and `LocaleFlag` takes the imported flags.
