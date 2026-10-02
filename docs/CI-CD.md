# Localization in CI/CD

Run the EveryLocale CLI before application checks and deployment. GitHub Actions, GitLab CI, and other runners with Node.js can use the same commands. A persistent EveryLocale service owns jobs, model credentials, approval policy, and translation memory; the runner needs only a scoped project token.

1. Extract declared messages or a supported document into source units.
2. Synchronize those sources and wait for the project's approval rules.
3. Pull a complete approved release.
4. Run application checks, build with that release, and deploy through your existing deployment process.

## GitHub Actions

This example is manually triggered and does not deploy anything by itself. Save it in your application's workflow directory, set `EVERYLOCALE_URL` and `EVERYLOCALE_TOKEN` as repository or environment secrets, and replace the project identifier and target locales. The project must already exist on the service.

```yaml
name: Approved localization release
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
      - uses: actions/setup-node@v6
        with:
          node-version: '22.16.0'
      - uses: pnpm/action-setup@v4
        with:
          version: '9.15.9'
      - name: Check out the localization toolkit
        uses: actions/checkout@v5
        with:
          repository: bomsn/EveryLocale
          ref: ccbdaec5f109f5e15485c7a1b5cc68140193f0fc
          path: tools/everylocale
      - name: Prepare the CLI
        run: |
          pnpm --dir tools/everylocale install --frozen-lockfile
          pnpm --dir tools/everylocale build
      - name: Deliver approved translations
        env:
          EVERYLOCALE_URL: ${{ secrets.EVERYLOCALE_URL }}
          EVERYLOCALE_TOKEN: ${{ secrets.EVERYLOCALE_TOKEN }}
        run: |
          pnpm --dir tools/everylocale cli extract --input "$GITHUB_WORKSPACE/messages.json" --format json --namespace app --output "$GITHUB_WORKSPACE/source.json"
          pnpm --dir tools/everylocale cli sync --project your-project --input "$GITHUB_WORKSPACE/source.json" --locales ar,zh-Hant-TW,de,es,fr --wait --timeout 600
          pnpm --dir tools/everylocale cli pull --project your-project --output "$GITHUB_WORKSPACE/locales"
      - name: Check and build the application
        run: |
          pnpm install --frozen-lockfile
          pnpm test
          pnpm build
```

The final commands assume a pnpm application with `test` and `build` scripts. Configure that application to capture `locales/current.json` once and read the catalogs from its immutable release directory. Change the commands to match your stack. Add your existing deployment step only after the build succeeds. Pin third-party Actions to reviewed commit hashes according to your repository's supply-chain policy.

## Failure and recovery

`sync --wait` exits unsuccessfully on failed, stale, blocked, or timed-out work. Human approval projects wait in the review workspace; rerun the workflow after approval. Automatic approval permits only candidates that pass the project's checks and AI review. No model credential or ChatGPT refresh token belongs in Actions.

`pull` validates a complete current release before atomically changing the local pointer. Never build from individual files fetched at different times. A failed synchronization leaves the deployed application unchanged. Keep the prior application deployment and catalog release for rollback; [CLI delivery](CONNECT.md) documents checksum verification and pointer rollback.

Use a trusted runner that can reach the service over HTTPS. Do not expose secrets to untrusted pull requests or run untrusted checkout code with deployment permissions. Choose your release branch, approval environment, and workflow triggers explicitly. Localization approval grants neither a repository merge nor permission to deploy.

## Other runners

Install the same pinned toolkit checkout and run extraction, synchronization, pull, and application checks in order. GitLab CI, Jenkins, and other runners do not require a dedicated EveryLocale action. Store the service URL and scoped token in their secret manager, preserve the approved artifacts between build stages, and serialize deployments for the same environment.
