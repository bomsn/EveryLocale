# Contributing

Use `develop` for ongoing changes and pull requests. `master` contains maintainer-approved releases. Updating `master` requires an explicit release decision from the maintainer.

## Local checks

Requires Node.js 22.16 or newer, pnpm 9.15.9, and Docker.

```sh
pnpm install --frozen-lockfile
pnpm ci:local
```

The local runner builds and checks the packages, runs the functional suite, packs the release, verifies a production Next.js consumer, runs Linux checks on Node 22 and 24, builds the service image, and tests the WordPress connector. Tests use local provider fixtures.

GitHub Actions runs on `master` updates. Pushes and pull requests to `develop` do not trigger the workflow.

## Changes

Include a reproduction or example for behavioral changes. Tests should exercise the real parsers and SQLite state machine; use a local HTTP fixture for model transport. Keep credentials, customer data, local databases, and development notes out of commits.

Public documentation describes installation, configuration, APIs, and supported behavior. Keep planning notes and project-specific research outside the published documentation.
