# Contributing

Use `develop` for ongoing changes and pull requests. `master` contains maintainer-approved releases. Updating `master` requires an explicit release decision from the maintainer.

## Local checks

Requires Node.js 22.16 or newer, pnpm 9.15.9, and Docker.

```sh
pnpm install --frozen-lockfile
pnpm ci:local
```

`pnpm ci:host` runs the checks that need no Docker: build, type checks for packages, tests and tools, ESLint, unused-code detection (knip), formatting, the production dependency audit, the functional test suite, the release archives and a production Next.js consumer. `pnpm ci:local` adds Linux checks on Node 22 and 24, the service image and the WordPress connector. Tests use local provider fixtures and make no paid model calls.

GitHub Actions runs on `master` updates. Pushes and pull requests to `develop` do not trigger the workflow.

## Changes

- Include a test for every behavior change, including its failure paths. Tests exercise the real parsers and SQLite state machine; use a local HTTP fixture for model transport.
- Tests import the built packages from `packages/*/dist`, so run `pnpm build` before `pnpm test`.
- Fix lint findings in the code. A rule exception needs a same-line reason: `// eslint-disable-next-line rule -- reason`.
- Add a changeset for any change to a published package: `pnpm changeset`.
- Ask before adding a dependency, and pin exact versions.
- Keep credentials, customer data, local databases and development notes out of commits.

Public documentation describes installation, configuration, APIs and supported behavior. Keep planning notes and project-specific research outside the published documentation. See [the security policy](SECURITY.md) for reporting vulnerabilities and [the code of conduct](CODE_OF_CONDUCT.md) for participation.
