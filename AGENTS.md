# Agent operational safety: CF-Server-Monitor

This project uses Cloudflare Workers and the production D1 database `server-monitor-db`.
Protecting monitoring history and avoiding D1 free-tier row-read exhaustion take
priority over diagnostic convenience.

## Production D1: non-negotiable rules

1. **Prefer Cloudflare D1 Insights, GraphQL Analytics or Workers observability**
   for usage, query-volume and incident investigations. These APIs do not run
   SQL against the production D1 database.
2. **Never execute an unreviewed SQL statement against production
   `metrics_history` or `metrics_history_old`.** Before any historical
   read, inspect the statement and its `EXPLAIN QUERY PLAN` in a local
   SQLite/Miniflare database. If production verification is necessary,
   issue only `EXPLAIN QUERY PLAN` first; proceed only when the plan
   uses `SEARCH` on an appropriate primary-key range or on the
   `(server_id, timestamp DESC)` index.
3. Reject `SCAN metrics_history`, `SCAN h`, correlated subqueries that
   rescan the history table, cross joins, `ORDER BY RANDOM()`, unbounded
   aggregates, and `COUNT(*)` over the entire history table. A small
   `LIMIT` does **not** make a scan safe.
4. For routine diagnostics use existing application APIs or a narrow
   `WHERE server_id = ? ORDER BY timestamp DESC LIMIT 20` query, **only
   after confirming the index exists and the query plan uses it**.
   Prefer existing encoded partition-id range queries for application
   traffic.
5. Never run stress tests, bulk history reads, or index rebuilds against
   production without the user's explicit approval. Do not run D1 queries
   while its quota is exhausted. A failed query is not evidence of data loss.
6. Do not delete or truncate history, rotate tables, alter probe cadence,
   change server configuration, or upgrade to a paid plan while diagnosing
   D1 read limits unless the user explicitly requests that action.

## Before changing history SQL

- Read `docs/D1-QUERY-SAFETY.md` and
  `src/database/historyIndexes.js`.
- Run `npm run test:history-query` and the project's existing test suite.
- Add a local query-plan regression test when introducing a new historical
  access pattern; do not rely on regex checks alone.
- Confirm the weekly `metrics_history` / `metrics_history_old` rotation
  preserves the server/time index.
- Verify Cloudflare build and 100% deployment before reporting success.

## Incident reference

On 2026-11-13 around 01:57 UTC, D1 Analytics reported an abrupt peak of
roughly 71 million rows read in one minute, exceeding the 5-million
rows/day free allowance. The precise SQL statement was not confirmed.
Do not reproduce the suspected query on production to investigate it.
