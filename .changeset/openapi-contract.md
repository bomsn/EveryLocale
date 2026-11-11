---
'@everylocale/server': minor
'@everylocale/store': patch
---

Every HTTP endpoint is declared once, with its access rule and zod schemas for path, query, headers, body and response. The declaration validates the request, enforces the access rule before the query or body is read, and outside production checks the response. It also generates the OpenAPI 3.1 document served at `/api/v1/openapi.json` and committed as `docs/openapi.json`. A test fails when the committed document differs from the served one.

Behavior changes: a caller without valid credentials now gets 401 or 403 before any validation error. Set `NODE_ENV=production` to skip response checks; the published container image already does.
