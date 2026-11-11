# @everylocale/store

The SQLite state machine behind the EveryLocale service: sources and documents, translation jobs and leases, budgets, approvals bound to exact revisions, releases, tokens, sessions, delivery events and numbered migrations with a backup before each upgrade.

```sh
npm install @everylocale/store
```

Most people run the service rather than use this package directly. A custom storage backend implements the `TranslationStore` or `LocalizationStore` interface and must keep the same transactional guarantees.

## Documentation

- [Connect your app](https://github.com/bomsn/EveryLocale/blob/develop/docs/CONNECT.md)
- [Runtime integration](https://github.com/bomsn/EveryLocale/blob/develop/docs/INTEGRATION.md)
- [CLI reference](https://github.com/bomsn/EveryLocale/blob/develop/docs/CLI.md)
- [HTTP API](https://github.com/bomsn/EveryLocale/blob/develop/docs/API.md)

EveryLocale is a self-hosted localization toolkit: it translates the text you change, checks every translation with a separate AI review, and delivers only approved translations to your app. MIT licensed.
