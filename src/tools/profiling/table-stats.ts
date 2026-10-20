import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { findTable, loadCatalog, quoteIdent, quotedName } from "../../common/catalog.js";
import type { Db } from "../../common/db.js";
import { json, run } from "../../common/result.js";

export function registerTableStats(server: McpServer, db: Db): void {
  server.registerTool(
    "table_stats",
    {
      description:
        "Profile a table in one query: row count and, per column, distinct count, NULL count, MIN and MAX. " +
        "Without columns every column is profiled, which scans the whole table on its backend.",
      inputSchema: z.object({
        table: z.string().describe("Full table name from list_tables"),
        columns: z.array(z.string()).optional().describe("Only these columns"),
      }),
    },
    ({ table, columns }) =>
      run(async () => {
        const catalog = await loadCatalog(db);
        const t = findTable(catalog, table);
        const known = catalog.columns(t).map((c) => c.name);
        const unknown = (columns ?? []).filter((c) => !known.includes(c));
        if (unknown.length) throw new Error(`no such column(s) in ${t.name}: ${unknown.join(", ")}`);
        const names = columns ?? known;

        // explicit unique aliases: without them the pushdown names every aggregate
        // `count`/`min`/`max`, and ClickHouse refuses the duplicate aliases
        const aggregates = names.flatMap((c, i) => {
          const col = quoteIdent(c);
          return [
            `COUNT(DISTINCT ${col}) AS "d${i}"`,
            `COUNT(${col}) AS "c${i}"`,
            `MIN(${col}) AS "min${i}"`,
            `MAX(${col}) AS "max${i}"`,
          ];
        });
        const sql = `SELECT ${['COUNT(*) AS "n"', ...aggregates].join(", ")} FROM ${quotedName(t)}`;
        const [row] = (await db.query({ text: sql, rowMode: "array" })).rows;

        const rowCount = Number(row[0]);
        return json({
          table: t.name,
          row_count: rowCount,
          columns: names.map((name, i) => {
            const [distinct, nonNull, min, max] = row.slice(1 + i * 4, 5 + i * 4);
            return { name, distinct: Number(distinct), nulls: rowCount - Number(nonNull), min, max };
          }),
        });
      }),
  );
}
