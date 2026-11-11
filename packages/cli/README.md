# @everylocale/cli

The `everylocale` command for builds and CI. It reads `everylocale.config.json` from your app.

```sh
npm install --save-dev @everylocale/cli
```

```sh
npx everylocale sync --wait   # upload changed sources, wait for approval
npx everylocale pull          # write a verified release and the translated files
npx everylocale check --code src   # offline: completeness, staleness, ICU structure, unknown ids
```

Also `import` (bring existing translations in), `codegen` (typed message ids) and `rollback`. Online commands read `EVERYLOCALE_URL` and a scoped `EVERYLOCALE_TOKEN`.

## Documentation

- [Connect your app](https://github.com/bomsn/EveryLocale/blob/develop/docs/CONNECT.md)
- [Runtime integration](https://github.com/bomsn/EveryLocale/blob/develop/docs/INTEGRATION.md)
- [CLI reference](https://github.com/bomsn/EveryLocale/blob/develop/docs/CLI.md)
- [HTTP API](https://github.com/bomsn/EveryLocale/blob/develop/docs/API.md)

EveryLocale is a self-hosted localization toolkit: it translates the text you change, checks every translation with a separate AI review, and delivers only approved translations to your app. MIT licensed.
