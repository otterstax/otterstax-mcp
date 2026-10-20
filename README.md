# OtterStax MCP server

An [MCP](https://modelcontextprotocol.io) server for [OtterStax](https://github.com/otterstax/otterstax), the federated SQL server. It lets an AI agent (Claude Code, Claude Desktop, Codex, opencode, …) discover the data behind OtterStax — MySQL/MariaDB, PostgreSQL, ClickHouse, S3 and Kafka — and query it with SQL.

The server runs locally over stdio and talks to OtterStax over its PostgreSQL wire protocol.

## Configuration

| Variable | Default | |
|---|---|---|
| `OTTERSTAX_URL` | `postgresql://localhost:8817` | PostgreSQL-wire address of the OtterStax server |

OtterStax does not check credentials, so the URL needs only host and port. The server runs any SQL you send it: point it only at an OtterStax you are allowed to change.

## Install

Requires Node.js 22 or newer (Claude Desktop ships its own).

### Claude Desktop

Download `otterstax-mcp.mcpb` and open it: Claude Desktop installs it and asks for the OtterStax URL.

Or add it to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "otterstax": {
      "command": "npx",
      "args": ["-y", "@otterstax/mcp"],
      "env": { "OTTERSTAX_URL": "postgresql://localhost:8817" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add otterstax -e OTTERSTAX_URL=postgresql://localhost:8817 -- npx -y @otterstax/mcp
```

### Codex

```bash
codex mcp add otterstax --env OTTERSTAX_URL=postgresql://localhost:8817 -- npx -y @otterstax/mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.otterstax]
command = "npx"
args = ["-y", "@otterstax/mcp"]
tool_timeout_sec = 600   # Codex stops a tool after 60 s by default; federated queries can take longer

[mcp_servers.otterstax.env]
OTTERSTAX_URL = "postgresql://localhost:8817"
```

### opencode

In `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "otterstax": {
      "type": "local",
      "command": ["npx", "-y", "@otterstax/mcp"],
      "environment": { "OTTERSTAX_URL": "postgresql://localhost:8817" }
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `execute_sql(sql)` | Runs any statement. Returns `{columns, rows, row_count}`; `row_count` is rows returned, or rows affected for DML. |
| `explain_query(sql)` | Runs `EXPLAIN <sql>`. OtterStax builds without EXPLAIN support return their error. |
| `list_databases()` | Connection aliases (`kind: "connection"`) and local engine databases (`kind: "local"`). |
| `list_schemas(database)` | `<db>` (MySQL/ClickHouse) or `<db>.<schema>` (PostgreSQL) inside a connection. |
| `list_tables(database?, schema?)` | Tables and views under the full names to use in SQL, e.g. `sales.ops.orders`. |
| `describe_table(table)` | Columns with SQL types and nullability. |
| `search_objects(object_type, pattern, detail_level, limit)` | Finds tables or columns by LIKE pattern. `summary`/`full` on tables also count rows (one `COUNT(*)` per match). |
| `table_stats(table, columns?)` | Row count and per-column distinct count, NULL count, MIN and MAX in one query. |

Errors come back as tool errors (`isError: true`) with `{error, code}`, where `code` is the SQLSTATE OtterStax sent. If OtterStax goes down, the next call reconnects on its own.

The server also gives the agent OtterStax's SQL rules (table naming, date handling, query shapes that are known to crash the engine) as MCP server instructions.

## Development

```bash
npm install
npm run build            # dist/index.js, one self-contained file
npm test                 # unit tests
npm run test:integration # against a live OtterStax, see below
npm run build:mcpb       # otterstax-mcp.mcpb
```

Integration tests expect the OtterStax quick start on `localhost:8817`:

```bash
cd otterstax/examples/quick_start && docker compose up -d
```

They restart the `qs-otterstax` container once to check reconnection.

## License

Apache-2.0
