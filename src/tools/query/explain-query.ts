import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Db } from "../../common/db.js";
import { queryResult, run } from "../../common/result.js";

export function registerExplainQuery(server: McpServer, db: Db): void {
  server.registerTool(
    "explain_query",
    {
      description:
        "Show the plan of a statement (EXPLAIN <sql>). The OtterStax build you talk to may not support EXPLAIN yet; " +
        "then this returns the server's error.",
      inputSchema: z.object({ sql: z.string().describe("The statement to explain") }),
    },
    ({ sql }) => run(async () => queryResult(await db.query({ text: `EXPLAIN ${sql}`, rowMode: "array" }))),
  );
}
