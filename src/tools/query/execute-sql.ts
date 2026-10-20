import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Db } from "../../common/db.js";
import { queryResult, run } from "../../common/result.js";

export function registerExecuteSql(server: McpServer, db: Db): void {
  server.registerTool(
    "execute_sql",
    {
      description:
        "Run any SQL statement on OtterStax (SELECT, DDL, DML, COPY, CREATE SOURCE/STREAM). " +
        "Tables must be fully qualified: alias.db.table or alias.db.schema.table. " +
        "Returns {columns, rows, row_count}; all values come back as text or JSON numbers.",
      inputSchema: z.object({ sql: z.string().describe("The SQL statement to run") }),
    },
    ({ sql }) => run(async () => queryResult(await db.query({ text: sql, rowMode: "array" }))),
  );
}
