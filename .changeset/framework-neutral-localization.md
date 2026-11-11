---
'@everylocale/runtime': minor
'@everylocale/react-router': minor
---

`loadLocalization({ config, drafts, onFallback })` from `@everylocale/runtime/server` reads `everylocale.config.json` and its verified release once, for any server framework. It returns the served locales, the full registry and `messages(locale, namespaces)`, and fails at startup when the release is missing, altered or does not cover the config. The React Router adapter's `createI18n` is built on it, and its configuration error is now `LocalizationConfigError`. The Next.js example loads its messages from a release the same way.
