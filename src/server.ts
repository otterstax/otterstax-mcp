import { McpServer } from "@modelcontextprotocol/server";
import type { Db } from "./common/db.js";
import instructions from "./instructions.md";
import { registerDescribeTable } from "./tools/metadata/describe-table.js";
import { registerListDatabases } from "./tools/metadata/list-databases.js";
import { registerListSchemas } from "./tools/metadata/list-schemas.js";
import { registerListTables } from "./tools/metadata/list-tables.js";
import { registerSearchObjects } from "./tools/metadata/search-objects.js";
import { registerTableStats } from "./tools/profiling/table-stats.js";
import { registerExecuteSql } from "./tools/query/execute-sql.js";
import { registerExplainQuery } from "./tools/query/explain-query.js";

export function createServer(db: Db): McpServer {
  const server = new McpServer({ name: "otterstax", version: "0.0.0" }, { instructions });
  registerExecuteSql(server, db);
  registerExplainQuery(server, db);
  registerListDatabases(server, db);
  registerListSchemas(server, db);
  registerListTables(server, db);
  registerDescribeTable(server, db);
  registerSearchObjects(server, db);
  registerTableStats(server, db);
  return server;
}
