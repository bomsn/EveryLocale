# HTTP API v1

All project endpoints require an owner bearer token or a token scoped to that project. Browser sessions use an HttpOnly signed cookie, the exact configured Origin, and `X-CSRF-Token` for mutations. Tokens and sessions never grant access to another project. Responses use `Cache-Control: no-store`.

The prefix is `/api/v1`. A project identifier contains lowercase letters, digits, underscores, and hyphens.

| Method / path                                                    | Permission | Purpose                                                                                               |
| ---------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `GET /projects`                                                  | read       | List accessible project configurations and budget usage                                               |
| `GET /projects/{project}`                                        | read       | Configuration and pipeline revision                                                                   |
| `PUT /projects/{project}`                                        | owner      | Create/update project; source locale cannot change                                                    |
| `POST /projects/{project}/sources`                               | import     | Import `{units:[SourceUnit]}`                                                                         |
| `POST /projects/{project}/documents`                             | import     | Parse/import `{namespace,format,content}`                                                             |
| `GET /projects/{project}/documents`                              | read       | Imported namespaces and source revisions                                                              |
| `POST /projects/{project}/withdraw`                              | import     | Withdraw `{unitIds:[string]}` and linked publications                                                 |
| `POST /projects/{project}/jobs`                                  | translate  | Submit `{unitIds,locales}` with `Idempotency-Key`                                                     |
| `GET /projects/{project}/summary`                                | read       | Current-source coverage for each configured target; independent of pagination                         |
| `GET /projects/{project}/jobs`                                   | read       | Progress; `cursor`, `limit` (1-200), optional `locale`, `status`, `search`, `current=true`            |
| `GET /projects/{project}/jobs/{id}`                              | read       | Exact source, candidate, findings, cost and revision                                                  |
| `GET /projects/{project}/jobs/{id}/validation`                   | read       | Current deterministic checks, separate from AI advice                                                 |
| `PATCH /projects/{project}/jobs/{id}`                            | review     | `{revision,translation}`; queues independent review                                                   |
| `POST /projects/{project}/jobs/{id}/approve`                     | approve    | `{revision,overrideReason?}`; binds exact revisions                                                   |
| `POST /projects/{project}/approve`                               | approve    | Atomic `{entries:[{id,revision}]}` approval batch                                                     |
| `POST /projects/{project}/jobs/{id}/retry`                       | translate  | Retry a failed current job                                                                            |
| `POST /projects/{project}/preview`                               | read       | Format `{locale,message,values?}` with AST-derived defaults; returns text and typed example arguments |
| `GET /projects/{project}/exports/{locale}`                       | export     | Approved catalog; `current=true` requires complete current sources                                    |
| `POST /projects/{project}/exports/{locale}`                      | export     | Snapshot approved catalog for rollback                                                                |
| `GET /projects/{project}/documents/{namespace}/export/{locale}`  | export     | Render a document after all current segments are approved                                             |
| `GET /projects/{project}/documents/{namespace}/preview/{locale}` | read       | Sandboxed private source/translation preview; `isPreview=true` and untranslated segment IDs           |
| `GET /projects/{project}/artifacts`                              | export     | Saved approved versions; optional `locale`                                                            |
| `POST /projects/{project}/rollback`                              | approve    | `{locale,artifactId}`; never restores withdrawn content                                               |
| `GET /projects/{project}/audit`                                  | read       | Latest 200 approval, editing, and configuration events                                                |
| `GET /projects/{project}/tokens`                                 | owner      | Inspect token permissions, expiry, revocation; never plaintext keys                                   |
| `POST /projects/{project}/tokens`                                | owner      | `{scopes,expiresAt}`; plaintext token returned only once                                              |
| `DELETE /projects/{project}/tokens/{id}`                         | owner      | Revoke access and existing sessions                                                                   |

`GET /health` is unauthenticated liveness. `GET /api/v1/locales` returns the public presentation registry. The review workspace is `/`.

## Source unit

```json
{
  "id": "onboarding.welcome",
  "source": "Welcome, {name}",
  "sourceLocale": "en",
  "kind": "icu",
  "context": "Greeting after sign-in",
  "protectedTerms": ["EveryLocale"]
}
```

Use stable explicit IDs for application messages. Text formats are parsed to protected segments; they are not sent as unrestricted document strings. A source hash includes the unit's source, context, kind, and protected terms. A translation cache adds target locale, glossary, language guidance, and pipeline revision. A translation record includes these source and context hashes, the source data, protected terms, candidate, review findings, approval revision, status, attempts, and measured cost.

## Project configuration

```json
{
  "name": "Website",
  "sourceLocale": "en",
  "targetLocales": ["ar", "zh-Hant-TW", "de", "es", "fr"],
  "budgetUsd": 5,
  "approvalMode": "automatic",
  "glossary": [{ "source": "EveryLocale", "targets": {}, "keep": true }],
  "instructions": { "zh-Hant-TW": "Use Taiwan terminology." }
}
```

Budget is cumulative per project. Removing a target disables exports for it. Lowering budget below spent plus reserved usage is rejected. Changing guidance invalidates candidate approvals; old published revisions remain available until replacement or withdrawal.

`approvalMode` accepts `automatic` or `human`. API requests that omit it default to `human`; the workspace selects `automatic` when creating a project. Only the owner can configure the mode. Automatic approval requires successful deterministic validation and no major or critical findings. Approval records the exact source and translation revisions, with audit actor `automation`. Changing mode applies to future job completions without approving queued candidates or changing translation context.

## Jobs and failures

States are `pending`, `running`, `review`, `approved`, `failed`, and `stale`. Never publish from `review`. In automatic mode, clean AI-reviewed candidates transition to `approved` atomically; flagged candidates remain in `review`. In human mode, all candidates wait in `review`. Manual corrections re-enter the queue for independent review and preserve the old publication. A repeated idempotency key with the same source/configuration returns the original jobs; a different body/revision returns 409. Identical units with the same translation context reuse existing jobs. Reviewed translation memory may reuse wording when a segment moves; its new revision follows the configured approval mode.

Errors are `{error:{code,message}}`, with validation field names where appropriate. Codes include `revision_conflict`, `stale_source`, `structural_failure`, `review_findings`, `incomplete_catalog`, `incomplete_document`, `idempotency_conflict`, and `provider_configuration`. Clients should display the failure, reload conflicting revisions, and retry only replay-safe operations.

Project API keys are not provider API keys. Give WordPress `read/import/translate/export`, with no approval scope. Give editorial reviewers only the permissions they need. Keep all bearer tokens server-side in consuming applications.
