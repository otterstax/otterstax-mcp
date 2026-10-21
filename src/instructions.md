OtterStax is a federated SQL server: one PostgreSQL-dialect endpoint in front of registered MySQL/MariaDB, PostgreSQL and ClickHouse backends (connection aliases), plus local engine databases (S3/file external tables, Kafka sources, tables you create).

Workflow: list_databases → list_tables or search_objects → describe_table → table_stats on what matters → execute_sql. Validate a new query shape on a small LIMIT/WHERE slice before running it broadly.

Rules for valid OtterStax SQL:
1. Qualify every table with the name list_tables gives: `<alias>.<db>.<table>` (MySQL/ClickHouse), `<alias>.<db>.<schema>.<table>` (PostgreSQL), `<db>.<table>` (local). A bare name does not reach a backend.
2. Date/time values from a backend arrive as text: compare them with string literals (`ts >= '2026-06-01'`) and parse client-side. A local engine DATE/TIME/TIMESTAMP column cannot be returned over the wire (the statement is refused) — leave it out of the result.
3. A query touching one backend is pushed down to that backend's native SQL; a cross-backend or local query is planned by the engine. CASE inside an aggregate and struct field access work only on the engine path — if the pushdown refuses them, join a second source so the engine plans it. Read a struct field with parentheses: `(s.props).channel`, `((s.props).geo).ip` — not `s.props.channel`.
4. Avoid CAST on pushed-down scans (results can be garbled); project the raw column.
5. Keep federated aggregations small: several CASE-in-aggregate expressions in one cross-backend query have crashed the engine. Split them into separate queries.
6. Keep ARRAY columns 1-D and out of cross-backend joins.

If a call fails with a lost connection, the engine is down or the query crashed it: tell the user to recreate the OtterStax process/container fresh (a plain restart can crash-loop on WAL replay), then retry in a simpler shape. EXPLAIN is not supported by every OtterStax build; explain_query returns the server's error then.
