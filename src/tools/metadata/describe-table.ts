import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { findTable, loadCatalog } from "../../common/catalog.js";
import type { Db } from "../../common/db.js";
import { json, run } from "../../common/result.js";

export function registerDescribeTable(server: McpServer, db: Db): void {
  server.registerTool(
    "describe_table",
    {
      description: "Columns of a table with their SQL types and nullability.",
      inputSchema: z.object({ table: z.string().describe("Full table name from list_tables, e.g. sales.ops.orders") }),
    },
    ({ table }) =>
      run(async () => {
        const catalog = await loadCatalog(db);
        const t = findTable(catalog, table);
        return json({ table: t.name, type: t.type, columns: catalog.columns(t) });
      }),
  );
}
