# Contributing

Use `develop` for ongoing changes and pull requests. `master` contains maintainer-approved releases. Updating `master` requires an explicit release decision from the maintainer.

## Local checks

Requires Node.js 22.16 or newer, pnpm 9.15.9, and Docker.

```sh
pnpm install --frozen-lockfile
pnpm ci:local
```

`pnpm ci:host` runs the checks that need no Docker: build, type checks for packages, tests and tools, ESLint, unused-code detection (knip), formatting, plain punctuation, the production dependency audit, browser bundle budgets, the functional test suite with coverage, React 19 with React Router 7 and 8, the release archives, a production Next.js consumer, and the React Router example in Chromium (Playwright downloads Chromium on first run). `pnpm ci:local` adds Linux checks on Node 22 and 24, the service image and the WordPress connector. Tests use local provider fixtures and make no paid model calls. `pnpm live:check` is the one paid check, run by hand: it sends ten representative messages into four locales through the provider in `.env` under a hard budget (default US$0.05), then pulls and checks the release. `--model`, `--input-price` and `--output-price` override the model for that run, for example `pnpm live:check --model openai/gpt-4.1-nano --input-price 0.1 --output-price 0.4` on OpenRouter, which costs well under a cent. `pnpm coverage` runs the suite under c8, including the CLI and service processes the tests start, and fails below the floors in `.c8rc.json`. The floors follow measured coverage: raise them when coverage rises, never lower them to pass.

GitHub Actions runs only when started by hand; pushes and pull requests trigger nothing. To run it, open **Actions → Verify EveryLocale → Run workflow** and choose the branch, or run `gh workflow run ci.yml --ref develop` and follow it with `gh run watch`. Run `pnpm ci:local` before asking a maintainer to start it.

## Changes

- Include a test for every behavior change, including its failure paths. Tests exercise the real parsers and SQLite state machine; use a local HTTP fixture for model transport.
- Tests import the built packages from `packages/*/dist`, so run `pnpm build` before `pnpm test`. Tests run with Node's built-in type stripping, so they import other test helpers and tools with their `.ts` extension.
- Fix lint findings in the code. A rule exception needs a same-line reason: `// eslint-disable-next-line rule -- reason`.
- Add a changeset for any change to a published package: `pnpm changeset`.
- After changing an HTTP route schema or the config schema, run `pnpm codegen` and commit `docs/openapi.json` and `packages/core/schema/config-1.json`; tests fail while they differ.
- Ask before adding a dependency, and pin exact versions.
- Keep credentials, customer data, local databases and development notes out of commits.

Public documentation describes installation, configuration, APIs and supported behavior. Keep planning notes and project-specific research outside the published documentation. See [the security policy](SECURITY.md) for reporting vulnerabilities and [the code of conduct](CODE_OF_CONDUCT.md) for participation.

## Releasing

Maintainers release from `develop` after `pnpm ci:local` passes on a clean checkout:

1. `pnpm changeset version` collects the changesets into changelogs and sets the new version. Set the same version in the root and example `package.json` files, `compose.yaml` and the WordPress plugin header; a test checks they agree. Run `pnpm codegen` so `docs/openapi.json` carries it.
2. `pnpm ci:local` on a clean clone. It builds the archives in `artifacts/` with `pnpm release:pack`.
3. Publish those archives, dependencies first: `core`, `runtime`, `store`, `react`, `adapters`, `cli`, `react-router`, `server`, each with `npm publish artifacts/everylocale-NAME-VERSION.tgz --access public`. The npm account needs two-factor authentication, and npm asks for it on publish.
4. `pnpm test:next:registry` installs the published packages from npm into the Next.js example and runs the consumer checks.
