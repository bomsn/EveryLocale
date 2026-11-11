---
'@everylocale/core': minor
'@everylocale/store': minor
'@everylocale/server': minor
---

Projects replace `approvalMode` with ordered `policies`. Each rule matches by namespace glob, key glob or unit tag, and sets `translate` (`ai`, or `human` so the text never reaches a model) and `approve` (`automatic` or `human`). The last rule must match every message. Existing projects keep their behavior through the database migration.

`locked` unit id globs publish the source text in every locale without model work. Unit `tags` select policies and never change a message's source revision.

`POST /projects/{project}/translations` imports existing translations as candidates. Each follows its message's policy, and every rejected entry is reported with its reason.

Project tokens can be limited to `locales` and `namespaces`. A limited token sees and changes only those messages, and cannot download the full bundle.

Workspace sessions are stored on the server: signing out revokes the session, and `DELETE /api/v1/sessions` signs out every browser.

The database schema is upgraded by numbered migrations. An existing database is copied before its first pending migration, and a database from a newer release is refused without changes.

The service logs JSON lines with request ids, without tokens, cookies or content, and returns the request id with every response and unexpected error. `EVERYLOCALE_LOG_LEVEL` sets the level and `EVERYLOCALE_TRUST_PROXY` names the proxies whose forwarded client address is trusted.
