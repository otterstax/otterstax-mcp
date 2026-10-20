import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadCatalog } from "../../common/catalog.js";
import type { Db } from "../../common/db.js";
import { json, run } from "../../common/result.js";

export function registerListSchemas(server: McpServer, db: Db): void {
  server.registerTool(
    "list_schemas",
    {
      description:
        "List the schemas inside a database: '<db>' for a MySQL/ClickHouse connection, '<db>.<schema>' for a " +
        "PostgreSQL one. A local database has none.",
      inputSchema: z.object({ database: z.string().describe("Database name from list_databases") }),
    },
    ({ database }) =>
      run(async () => {
        const catalog = await loadCatalog(db);
        if (!catalog.databases.some((d) => d.name === database)) throw new Error(`database '${database}' not found`);
        const schemas = new Set(
          catalog.tables.filter((t) => t.database === database && t.qualifier.length > 0).map((t) => t.qualifier.join(".")),
        );
        return json({ database, schemas: [...schemas].sort() });
      }),
  );
}
