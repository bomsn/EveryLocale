# Connect your application

EveryLocale runs independently of your app. Keep model credentials and project tokens on the server or in CI. The workspace never needs your translation API key.

## Files and CLI

Run these commands from the EveryLocale checkout. Input paths can be absolute paths to files in another repository.

1. In the workspace, create a project and choose its target languages, spending limit, and automatic or human approval mode.
2. Open **Connect → Manage access** and create a token with read, import, translate, and export permissions. Leave approval permission with your publishing owner.
3. Set `EVERYLOCALE_URL` and `EVERYLOCALE_TOKEN` in your shell or CI secrets. The service URL is normally `http://localhost:4310` locally. Use HTTPS for remote access.

```sh
pnpm cli extract --input messages.json --format json --namespace app --output source.json
pnpm cli sync --project your-project --input source.json --locales ar,zh-Hant-TW,de,es,fr
```

Sync starts translation using the configured generation and review providers. To import without model calls, use `--import-only`. Use a stable namespace and explicit message IDs across source updates.

Automatic mode approves clean translations after validation and independent AI review. Human mode waits for workspace approval. Export once the current revisions are approved:

```sh
pnpm cli export --project your-project --locale ar --output locales/ar.approved.json
pnpm cli check --input source.json --catalog locales/ar.approved.json
```

The CLI export requires current approvals. Import the resulting JSON as a build artifact. Do not load pending review jobs into your public app. Commit catalogs as a reviewable repository change, and publish all catalogs in one atomic release with the previous release retained for rollback.

### Continuous delivery

For an automatic project, CI can wait for approval and pull all configured locales as one release:

```sh
pnpm cli sync --project your-project --input source.json --locales ar,zh-Hant-TW,de,es,fr --wait --timeout 600
pnpm cli pull --project your-project --output locales
```

Sync exits unsuccessfully if work fails, becomes stale, needs review, or exceeds the timeout. Human projects pause for review; rerun after approval. Pull rejects incomplete current approvals. `locales/current.json` points to an immutable directory under `locales/releases/REVISION/`, containing the source and target catalogs plus `bundle.json`. Capture the pointer once per build so every language comes from the same release. Keep prior directories for rollback:

```sh
pnpm cli rollback --output locales --revision PREVIOUS_REVISION
```

Rollback verifies all files before switching the pointer. `--allow-stale` explicitly permits earlier approved translations during source updates. Removing a target locale disables its next delivered release. Preserve the previous application deployment for application-level rollback.

In GitHub Actions, store only `EVERYLOCALE_URL` and the scoped `EVERYLOCALE_TOKEN` as secrets. Run extraction, sync, pull, application checks, and then your deployment step. Models and refresh credentials stay on the persistent EveryLocale service. Use a workflow concurrency group to avoid competing deployments. Choose the release branch and deployment permissions explicitly; translation approval does not grant repository merge or deployment authorization.

## React, Remix 2, and Next.js packages

Build package archives from the EveryLocale checkout:

```sh
pnpm release:pack
```

This creates `artifacts/everylocale-core-VERSION.tgz`, `everylocale-adapters-VERSION.tgz`, and `everylocale-react-VERSION.tgz`. Replace `VERSION` with the checkout's version in its root `package.json`. From your app folder, install the three matching archives. Replace `../everylocale` with the path to the checkout:

```sh
pnpm add ../everylocale/artifacts/everylocale-core-VERSION.tgz ../everylocale/artifacts/everylocale-adapters-VERSION.tgz ../everylocale/artifacts/everylocale-react-VERSION.tgz
```

For pnpm, configure `pnpm.overrides` in your app's `package.json` to resolve transitive core dependencies to that same archive. Use its absolute path with forward slashes, including on Windows:

```json
{
  "pnpm": {
    "overrides": {
      "@everylocale/core": "file:C:/path/to/everylocale/artifacts/everylocale-core-VERSION.tgz"
    }
  }
}
```

Add this override before installation so transitive dependencies resolve to the same archive.

Resolve language for each request, then load its approved catalog on the server:

```ts
import { EveryLocaleClient, resolveRequest } from '@everylocale/adapters';

const { locale, direction } = resolveRequest(request);
const client = new EveryLocaleClient(serviceUrl, projectToken);
const catalog = await client.catalog('your-project', locale);
```

The default client requires current approvals. For a deliberate policy of retaining an earlier approved publication during source updates, pass `false` as its third argument. That policy must be explicit in your release process.

Wrap the corresponding React tree using the same catalog:

```tsx
import { EveryLocaleProvider, Message } from '@everylocale/react';

<EveryLocaleProvider catalog={catalog}>
  <Message id="welcome" values={{ name: 'Sam' }} />
</EveryLocaleProvider>;
```

Set the document's `lang` and `dir` from the resolved request. Serialize the exact same catalog into hydration data. Never make a separate browser-language decision during hydration. English catalogs can be exported directly from the source; translated catalogs follow the project's approval mode.

For Remix 2, return these values from your root loader. Pass approved publication paths to `remixMeta`.

For Next.js, use a server layout and `generateMetadata` with `nextMetadata`. See `examples/next` for an App Router application.

## WordPress

Copy `adapters/wordpress/everylocale` into `wp-content/plugins/everylocale`, then activate it. Open **Settings → EveryLocale** in WordPress and enter your service URL, project identifier, and scoped token. Configure matching source and target locales.

Publishing or updating the original creates translation jobs and linked private drafts. Automatic approval or the optional human gate in EveryLocale permits publishing; a five-minute scheduled sync delivers approved translations. Material issues block automatic publication. Production needs a reliable system cron. The connector handles source revisions, withdrawal retries, localized slugs, redirects, alternate links, and locale-aware REST collections.

Connect the `everylocale_translation_published` hook to your application's authenticated, replay-safe cache invalidation delivery. Product-specific cache wiring is the host application's responsibility.

## Any other stack

Use the versioned HTTP API from your server. Import `/sources` or `/documents`, submit `/jobs` with an `Idempotency-Key`, poll progress, approve exact revisions, then read `/exports/{locale}`. The token's permissions determine which of these operations are available. A token used by a public app should not have approval permission.

See the [HTTP API](API.md) for endpoints and contracts. Catalog and page caches must include locale and approved revision. Account preferences and country decoration belong outside shared caches.

## Language and public pages

Public URLs choose the language; saved preferences choose private interfaces. Browser language can suggest, and country can decorate the selector. Neither should silently redirect people into another language.

Use `PublishedRegistry` for published routes, localized internal links, self-canonicals, reciprocal alternates, English x-default, metadata, structured data, and sitemaps. Unpublished or unsupported translations need a real unavailable response with an original-language link. The host owns account preference persistence, page publication records, emails, report rendering, and delivery to its deployment system.
