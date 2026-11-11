# HTTP API v1

Use this reference when writing a server-side integration. For files and builds, the [CLI](CLI.md) already does this work.

Every endpoint, with its parameters, request body, response schema and required access, is in the OpenAPI 3.1 document. A running service serves it at `/api/v1/openapi.json`, and the repository has a copy in [`docs/openapi.json`](openapi.json). Generate a client from it, or open it in any OpenAPI viewer. The document is produced from the same schemas that validate requests, so it describes exactly what the service accepts and returns.

## Authentication

Send a token in `Authorization: Bearer TOKEN`. The owner token (`EVERYLOCALE_ADMIN_TOKEN`) can do everything. Create project tokens in **Connect → Manage access**, or with `POST /api/v1/projects/{project}/tokens`. A project token belongs to one project and carries scopes:

| Scope | Allows |
| --- | --- |
| `read` | Project configuration, jobs, progress, documents, previews and audit log |
| `import` | Adding, updating and withdrawing sources; importing existing translations |
| `translate` | Queuing and retrying translation |
| `review` | Editing a candidate translation |
| `approve` | Approving candidates and rolling back a locale |
| `export` | Approved catalogs, bundles and documents |

A token can also be limited to some `locales` and `namespaces`, for example an agency token for French help pages only. Anything outside its limits answers 404, as if it did not exist. A limited token cannot export the full bundle. Tokens expire and can be revoked at once. The secret is returned only when the token is created.

Credentials are checked before the request body, so a caller without access never sees validation details. Keep every token on servers. A project token is not a model provider key, and a public browser must never receive one.

The workspace signs in with `POST /api/v1/session`, which sets an HTTP-only session cookie. Session requests that change data must come from the configured public origin and carry the `x-csrf-token` header returned at sign-in. Signing out revokes the session on the server, and the owner can revoke every session with `DELETE /api/v1/sessions`.

## The normal flow

1. **Import** sources: `POST /projects/{project}/documents` with a document of a registered format, or `POST /projects/{project}/sources` with source units. Importing makes no model request and costs nothing.
2. **Translate**: `POST /projects/{project}/jobs` with `unitIds`, `locales` and an `idempotency-key` header. A job is one message in one target locale. Repeating the request with the same key returns the same jobs and spends nothing again.
3. **Wait**: `GET /projects/{project}/requests/{key}` returns counts per status and per locale, plus every job that stops a release with its failure code.
4. **Download**: `GET /projects/{project}/bundle` returns the approved catalogs of every locale as one checksummed bundle. `complete=de,fr` fails unless those locales are fully approved. `GET /projects/{project}/exports/{locale}` returns one locale, and `GET /projects/{project}/documents/{namespace}/export/{locale}` renders one document in its original format.

## Source units

```json
{
  "id": "checkout:pay",
  "source": "Pay {amount}",
  "kind": "icu",
  "context": "Button on the payment step",
  "protectedTerms": ["EveryLocale"],
  "tags": ["checkout"]
}
```

Ids are stable and take the form `namespace:key`. A unit's source revision covers its text, context, kind and protected terms; tags do not change it. Documents are parsed into units, and their structure is protected. Translations can never change markup, links, code, ICU arguments or placeholders.

## Projects and policies

`PUT /projects/{project}` creates or replaces a project (owner only):

```json
{
  "name": "Shop",
  "sourceLocale": "en",
  "targetLocales": ["de", "fr-CA", "ar"],
  "budgetUsd": 20,
  "policies": [
    { "match": { "tag": "legal" }, "translate": "human", "approve": "human" },
    { "match": { "namespace": "marketing/**" }, "translate": "ai", "approve": "human" },
    { "match": {}, "translate": "ai", "approve": "automatic" }
  ],
  "locked": ["common:brand.*"],
  "glossary": [{ "source": "EveryLocale", "targets": {}, "keep": true }],
  "instructions": { "fr-CA": "Use Canadian French terminology." },
  "reviewerLanguage": "en"
}
```

Policies are checked in order and the first match applies. A match can name a `namespace` glob, a `key` glob and a `tag`. The last policy must match everything, so every message has an explicit rule. `translate: "human"` keeps the text away from every model: the job waits in `awaiting` until a person writes or imports a translation. `approve: "automatic"` approves a candidate that passes the structural checks and has no major or critical review findings; `approve: "human"` waits for a person. [How the workflow works](WORKFLOW.md#approval-policies) explains the choices.

`locked` lists unit id globs whose source text is used in every locale, such as brand names. `reviewerLanguage` is the language AI review findings are written in.

The budget is cumulative, in US dollars, and covers generation and review. It cannot be lowered below what is already spent or reserved. Changing the glossary or instructions requires new checked candidates. Published revisions stay available until their replacements are approved.

## Jobs

| Status | Meaning |
| --- | --- |
| `pending` | Waiting for a worker or a budget reservation |
| `running` | A model request is in progress |
| `awaiting` | The policy needs a person to write the translation |
| `review` | A candidate is ready; it waits for a person, or has findings to resolve |
| `approved` | This exact candidate, for this exact source, can be exported |
| `failed` | The job stopped; `failure` says why |
| `stale` | The source changed after this translation |

Editing (`PATCH /projects/{project}/jobs/{id}`) and approving (`POST .../approve`) take the `revision` the person saw and fail with `revision_conflict` if it changed meanwhile. Batch approval is all or nothing. Approval binds to the exact source and translation revisions. Approving a candidate with major findings needs an `overrideReason`, which the audit log records. Critical structural problems cannot be overridden.

`POST /projects/{project}/translations` brings existing translations in as candidates. Each entry follows its message's policy as an edit would, and rejected entries are returned with the reason.

## Failures

A failed job carries one of these codes in `failure`. Alerts and the workspace use the same codes.

| Code | Meaning | What to do |
| --- | --- | --- |
| `provider_configuration` | The provider rejected the key, account, permission or model. The provider is paused, and queued work waits. | Fix the settings, restart, resume the provider, then retry. |
| `provider_unavailable` | The provider was unreachable or overloaded after retries. | Queued work continues when it recovers. |
| `provider_rejected` | The provider refused this request, for example as too large. | Shorten or split the source, then retry. |
| `provider_response` | The response was malformed, oversized or reported no usage. | Check that the endpoint is OpenAI-compatible and reports usage. |
| `model_output_invalid` | The model did not return the required JSON. | Retry, or choose a model that supports JSON responses. |
| `structure_invalid` | The source has invalid ICU or protected structure. | Correct the source and import it again. |
| `budget_exhausted` | The project budget cannot cover the job. | Raise the budget if appropriate, then retry. |
| `cost_overrun` | Usage exceeded the amount reserved for the job. | Check the configured prices and output limit. |
| `lease_expired` | A worker stopped while processing the job three times. | Check the logs for restarts, then retry. |
| `internal` | An unexpected error. | Check the logs, then retry. |

## Errors

Errors are JSON: `{ "error": { "code": "...", "message": "..." } }`. Validation errors (`422`, code `validation`) add `fields`, and unexpected errors (`500`, code `internal`) add `requestId`, which matches the `x-request-id` response header and the service logs. Common codes: `unauthorized`, `forbidden`, `not_found`, `revision_conflict`, `stale_source`, `structural_failure`, `review_findings`, `incomplete_catalog`, `idempotency_conflict`, `budget`, `provider_configuration` and `rate_limit`.

Retry only replay-safe requests: `GET`, and `POST /jobs` with the same idempotency key. Reload and retry after `revision_conflict`.

## Service endpoints

`GET /health` answers while the process runs, without touching the database or providers. `GET /api/v1/operations` (owner only) reports budgets, queue age, failures, a paused provider and recent alerts. `POST /api/v1/providers/resume` resumes a paused provider. Every response carries `Cache-Control: no-store` and an `x-request-id`.
