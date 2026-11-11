# @everylocale/server

The self-hosted EveryLocale service: the HTTP API (described by OpenAPI at `/api/v1/openapi.json`), the translation worker, the review workspace, alerts and scheduled backups.

The usual way to run it is the Docker image or a checkout of the repository; see [Run a dependable service](https://github.com/bomsn/EveryLocale/blob/develop/docs/OPERATIONS.md). To embed it, `createApp(store, config)` from `@everylocale/server/dist/app.js` returns a Fastify instance.

## Documentation

- [Connect your app](https://github.com/bomsn/EveryLocale/blob/develop/docs/CONNECT.md)
- [Runtime integration](https://github.com/bomsn/EveryLocale/blob/develop/docs/INTEGRATION.md)
- [CLI reference](https://github.com/bomsn/EveryLocale/blob/develop/docs/CLI.md)
- [HTTP API](https://github.com/bomsn/EveryLocale/blob/develop/docs/API.md)

EveryLocale is a self-hosted localization toolkit: it translates the text you change, checks every translation with a separate AI review, and delivers only approved translations to your app. MIT licensed.
