---
'@everylocale/core': minor
'@everylocale/store': minor
'@everylocale/server': minor
'@everylocale/cli': minor
---

Every failed job records a failure code from `FAILURES`, each with a description and the action to take, and the API returns it with the job. `ProviderError` takes the failure code and options instead of positional flags.

A provider configuration failure, such as a rejected key or unknown model, pauses translation once and returns the job to the queue instead of failing every queued job. `GET /api/v1/operations` reports the pause, the workspace shows it, and `POST /api/v1/providers/resume` resumes.

Failure alerts are aggregated: at most one `alert.translation_failed` or `alert.budget_exhausted` event per project and failure code per hour, with the count, example job ids and the recommended action.

`GET /projects/{project}/requests/{key}` reports the progress of one submission, and `sync --wait` uses it, printing each message that needs attention with its status, failure and findings.

Scheduled backups: set `EVERYLOCALE_BACKUP_DIR`, and optionally `EVERYLOCALE_BACKUP_INTERVAL_HOURS` and `EVERYLOCALE_BACKUP_KEEP`. Each backup is integrity-checked before older ones are pruned, and a failed backup raises `alert.backup_failed`.

`maintenance check` and `restore`, and `pnpm doctor`, no longer modify the database they inspect.
