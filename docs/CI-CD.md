# Localization in CI/CD

Start with [a working config and a manual pull](CONNECT.md). CI/CD is your existing process that tests, builds and deploys the app. Add localization before those steps, so each release ships the latest approved wording in every live language.

For example, an English button changes from "Create a project" to "Create your first project". The workflow sends the change to EveryLocale, waits for the German translation to pass review, pulls the approved release, then builds. If a translation needs attention, the release stops, and the app you already deployed stays as it is.

A persistent EveryLocale service owns jobs, model keys, policies and translation memory. The runner needs only the service address and a project token with `read`, `import`, `translate` and `export`. Keep the service running outside the CI job, and make sure the runner can reach it over HTTPS.

## Two ways to run it

**Releases committed to the repository.** A person or a scheduled job runs `sync --wait` and `pull` and commits `.everylocale/` with the rendered files. Every pull request then runs the offline check, which needs no token and no network:

```sh
pnpm exec everylocale codegen --check
pnpm exec everylocale check --code src
```

This fails on a missing or stale translation in a live locale, a changed release file, a plural or argument mismatch, or a message id the code uses but no source file defines.

**Releases pulled during the build.** The deploy workflow syncs, waits and pulls, then builds from that release. The example below does this.

## GitHub Actions

This workflow runs on demand and does not deploy by itself. Save it in `.github/workflows/`, add `EVERYLOCALE_URL` and `EVERYLOCALE_TOKEN` as repository or environment secrets, and install `@everylocale/cli` in the app as described in [Connect your app](CONNECT.md#install-the-packages).

```yaml
name: Localized release
on:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: localized-release-${{ github.ref }}
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
        with:
          version: '9.15.9'
      - uses: actions/setup-node@v6
        with:
          node-version: '22.16.0'
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Translate and pull the approved release
        env:
          EVERYLOCALE_URL: ${{ secrets.EVERYLOCALE_URL }}
          EVERYLOCALE_TOKEN: ${{ secrets.EVERYLOCALE_TOKEN }}
        run: |
          pnpm exec everylocale sync --wait --timeout 900
          pnpm exec everylocale pull
          pnpm exec everylocale check --code src
      - run: pnpm test
      - run: pnpm build
```

Add your deployment step after the build. Pin third-party actions to reviewed commit hashes if your supply-chain policy requires it.

## Failure and recovery

`sync --wait` exits with an error when a message in a live locale fails, waits for a person, needs review or turns stale, and when the timeout passes. It lists each one with its locale, id, status and failure code. Fix the cause in the workspace or approve the work, then run the workflow again. Draft locales never block a release.

`pull` verifies the bundle and writes the release in full before it becomes active. Never assemble a release from files fetched at different times. Keep the previous deployment, and the previous release directory, for rollback: `everylocale rollback --revision PREVIOUS` reactivates an earlier release.

Use a trusted runner. Do not expose secrets to pull requests from forks, or run untrusted code with deployment permissions. No model key belongs in CI. Approving a translation grants neither a merge nor permission to deploy.

## Other runners

GitLab CI, Jenkins and other runners run the same commands in the same order. Store the service address and token in their secret manager, keep the release between build stages, and serialize deployments to the same environment.
