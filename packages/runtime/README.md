# @everylocale/runtime

Formats approved, precompiled EveryLocale messages in any JavaScript runtime, about 2.8 KB gzipped in a browser. On the server it loads the release `everylocale pull` wrote and verifies every checksum first.

```sh
npm install @everylocale/runtime
```

```ts
import { createFormatter } from '@everylocale/runtime';
import { loadLocalization } from '@everylocale/runtime/server';

const localization = await loadLocalization(); // reads everylocale.config.json and its release
const { format } = createFormatter({ locale: 'de', messages: localization.messages('de', ['checkout']) });
format('checkout:items', { count: 3 });
```

With the declarations `everylocale codegen` writes, message ids and their values are type-checked. `@everylocale/runtime/bundler` exports `parserAlias()` to keep the ICU parser out of webpack client bundles.

## Documentation

- [Connect your app](https://github.com/bomsn/EveryLocale/blob/develop/docs/CONNECT.md)
- [Runtime integration](https://github.com/bomsn/EveryLocale/blob/develop/docs/INTEGRATION.md)
- [CLI reference](https://github.com/bomsn/EveryLocale/blob/develop/docs/CLI.md)
- [HTTP API](https://github.com/bomsn/EveryLocale/blob/develop/docs/API.md)

EveryLocale is a self-hosted localization toolkit: it translates the text you change, checks every translation with a separate AI review, and delivers only approved translations to your app. MIT licensed.
