import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadCatalog } from "../../common/catalog.js";
import type { Db } from "../../common/db.js";
import { json, run } from "../../common/result.js";

export function registerListTables(server: McpServer, db: Db): void {
  server.registerTool(
    "list_tables",
    {
      description: "List tables and views under the full SQL names to use in execute_sql.",
      inputSchema: z.object({
        database: z.string().optional().describe("Only this database"),
        schema: z.string().optional().describe("Only this schema, as list_schemas shows it"),
      }),
    },
    ({ database, schema }) =>
      run(async () => {
        const tables = (await loadCatalog(db)).tables
          .filter((t) => database === undefined || t.database === database)
          .filter((t) => schema === undefined || t.qualifier.join(".") === schema)
          .map((t) => ({ name: t.name, type: t.type }));
        return json({ tables });
      }),
  );
}
