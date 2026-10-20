import type { McpServer } from "@modelcontextprotocol/server";
import { loadCatalog } from "../../common/catalog.js";
import type { Db } from "../../common/db.js";
import { json, run } from "../../common/result.js";

export function registerListDatabases(server: McpServer, db: Db): void {
  server.registerTool(
    "list_databases",
    {
      description:
        "List OtterStax databases. kind 'connection' is a registered backend (MySQL/PostgreSQL/ClickHouse) " +
        "whose tables are named <alias>.<db>.<table> or <alias>.<db>.<schema>.<table>; kind 'local' is an engine database.",
    },
    () => run(async () => json({ databases: (await loadCatalog(db)).databases })),
  );
}
