# Contributing

Use `develop` for ongoing changes and pull requests. `master` contains maintainer-approved releases. Updating `master` requires an explicit release decision from the maintainer.

## Local checks

Requires Node.js 22.16 or newer, pnpm 9.15.9, and Docker.

```sh
pnpm install --frozen-lockfile
pnpm ci:local
```

`pnpm ci:host` runs the checks that need no Docker: build, type checks for packages, tests and tools, ESLint, unused-code detection (knip), formatting, plain punctuation, the production dependency audit, browser bundle budgets, the functional test suite, React 19 with React Router 7 and 8, the release archives, a production Next.js consumer, and the React Router example in Chromium (Playwright downloads Chromium on first run). `pnpm ci:local` adds Linux checks on Node 22 and 24, the service image and the WordPress connector. Tests use local provider fixtures and make no paid model calls.

GitHub Actions runs on `master` updates. Pushes and pull requests to `develop` do not trigger the workflow.

## Changes

- Include a test for every behavior change, including its failure paths. Tests exercise the real parsers and SQLite state machine; use a local HTTP fixture for model transport.
- Tests import the built packages from `packages/*/dist`, so run `pnpm build` before `pnpm test`.
- Fix lint findings in the code. A rule exception needs a same-line reason: `// eslint-disable-next-line rule -- reason`.
- Add a changeset for any change to a published package: `pnpm changeset`.
- After changing an HTTP route schema or the config schema, run `pnpm codegen` and commit `docs/openapi.json` and `packages/core/schema/config-1.json`; tests fail while they differ.
- Ask before adding a dependency, and pin exact versions.
- Keep credentials, customer data, local databases and development notes out of commits.

Public documentation describes installation, configuration, APIs and supported behavior. Keep planning notes and project-specific research outside the published documentation. See [the security policy](SECURITY.md) for reporting vulnerabilities and [the code of conduct](CODE_OF_CONDUCT.md) for participation.
