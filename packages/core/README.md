# @everylocale/core

Shared building blocks of EveryLocale: the locale registry (`defineLocales`, `matchLocale`, `resolveLocale`, `localizePath`), the `everylocale.config.json` schema and parser, document formats (JSON, YAML, PO, Markdown, MDX, HTML), ICU validation and message compilation.

```sh
npm install @everylocale/core
```

```ts
import { defineLocales, resolveLocale } from '@everylocale/core/locales';

const locales = defineLocales('en', ['de', { id: 'zh-TW' }, 'ar']);
resolveLocale({ pathname: '/de/pricing', privateSurface: false, locales }); // 'de'
```

The JSON Schema for the config file is `@everylocale/core/schema/config-1.json`. Most apps use this package through `@everylocale/runtime`, `@everylocale/react` and `@everylocale/cli`.

## Documentation

- [Connect your app](https://github.com/bomsn/EveryLocale/blob/develop/docs/CONNECT.md)
- [Runtime integration](https://github.com/bomsn/EveryLocale/blob/develop/docs/INTEGRATION.md)
- [CLI reference](https://github.com/bomsn/EveryLocale/blob/develop/docs/CLI.md)
- [HTTP API](https://github.com/bomsn/EveryLocale/blob/develop/docs/API.md)

EveryLocale is a self-hosted localization toolkit: it translates the text you change, checks every translation with a separate AI review, and delivers only approved translations to your app. MIT licensed.
