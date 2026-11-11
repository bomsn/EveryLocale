---
'@everylocale/react': major
'@everylocale/runtime': minor
'@everylocale/core': minor
---

`@everylocale/react` formats with `@everylocale/runtime` instead of `react-intl`. `EveryLocaleProvider` takes the request's `locale` and precompiled `messages` (there is no default locale), `Message` and `useMessages().format()` are typed by the generated declarations, and rich-text tags are rendered by functions in `values`. Missing messages are reported once, or throw with `missing: 'throw'`.

`compileMessage` in core precompiles a message. `@everylocale/runtime/bundler` exports `parserAlias()` so client bundles drop the ICU parser. The React peer range is `>=18.3 <20`.

Browser entries are measured on every CI run: the runtime adds about 2.8 KB gzipped, the React message bindings about 3.0 KB, and the language controls about 1.3 KB.
