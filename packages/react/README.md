# @everylocale/react

React 18.3 and 19 bindings for EveryLocale messages, plus language controls with no built-in copy.

```sh
npm install @everylocale/react @everylocale/runtime
```

```tsx
import { EveryLocaleProvider, Message, useMessages } from '@everylocale/react';

<EveryLocaleProvider locale={locale} messages={messages}>
  <Message id="checkout:terms" values={{ link: (chunks) => <a href="/terms">{chunks}</a> }} />
</EveryLocaleProvider>;
```

`LanguageLinks` renders crawlable links with `hreflang`. `LanguageSelect` is a form that works without JavaScript. `LanguageSuggestion` offers the browser's language. Flags are opt-in per country: `import tw from '@everylocale/react/flags/tw'`. Optional Arabic and Traditional Chinese fonts are in `@everylocale/react/fonts.css`.

## Documentation

- [Connect your app](https://github.com/bomsn/EveryLocale/blob/develop/docs/CONNECT.md)
- [Runtime integration](https://github.com/bomsn/EveryLocale/blob/develop/docs/INTEGRATION.md)
- [CLI reference](https://github.com/bomsn/EveryLocale/blob/develop/docs/CLI.md)
- [HTTP API](https://github.com/bomsn/EveryLocale/blob/develop/docs/API.md)

EveryLocale is a self-hosted localization toolkit: it translates the text you change, checks every translation with a separate AI review, and delivers only approved translations to your app. MIT licensed.
