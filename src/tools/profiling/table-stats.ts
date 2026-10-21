import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { findTable, loadCatalog, quoteIdent, quotedName } from "../../common/catalog.js";
import type { Db } from "../../common/db.js";
import { isConnectionLost, json, run } from "../../common/result.js";

type ColumnStats = { name: string; distinct: number; nulls: number; min: unknown; max: unknown };

async function firstRow(db: Db, sql: string): Promise<unknown[]> {
  return (await db.query({ text: sql, rowMode: "array" })).rows[0];
}

// explicit unique aliases: without them the pushdown names every aggregate
// `count`/`min`/`max`, and ClickHouse refuses the duplicate aliases
function aggregates(column: string, i: number, withMinMax: boolean): string[] {
  const col = quoteIdent(column);
  const counts = [`COUNT(DISTINCT ${col}) AS "d${i}"`, `COUNT(${col}) AS "c${i}"`];
  return withMinMax ? [...counts, `MIN(${col}) AS "min${i}"`, `MAX(${col}) AS "max${i}"`] : counts;
}

// One query for the whole table. A backend may refuse MIN/MAX for one column's
// type (PostgreSQL has none for uuid); then each column is profiled on its own and
// only that column loses min/max.
async function profile(db: Db, from: string, names: string[]): Promise<{ rowCount: number; columns: ColumnStats[] }> {
  try {
    const row = await firstRow(db, `SELECT ${['COUNT(*) AS "n"', ...names.flatMap((c, i) => aggregates(c, i, true))].join(", ")} FROM ${from}`);
    const rowCount = Number(row[0]);
    return {
      rowCount,
      columns: names.map((name, i) => {
        const [distinct, nonNull, min, max] = row.slice(1 + i * 4, 5 + i * 4);
        return { name, distinct: Number(distinct), nulls: rowCount - Number(nonNull), min, max };
      }),
    };
  } catch (e) {
    if (isConnectionLost(e)) throw e;
  }

  const rowCount = Number((await firstRow(db, `SELECT COUNT(*) AS "n" FROM ${from}`))[0]);
  const columns: ColumnStats[] = [];
  for (const name of names) {
    let row: unknown[];
    try {
      row = await firstRow(db, `SELECT ${aggregates(name, 0, true).join(", ")} FROM ${from}`);
    } catch (e) {
      if (isConnectionLost(e)) throw e;
      row = [...(await firstRow(db, `SELECT ${aggregates(name, 0, false).join(", ")} FROM ${from}`)), null, null];
    }
    const [distinct, nonNull, min, max] = row;
    columns.push({ name, distinct: Number(distinct), nulls: rowCount - Number(nonNull), min, max });
  }
  return { rowCount, columns };
}

export function registerTableStats(server: McpServer, db: Db): void {
  server.registerTool(
    "table_stats",
    {
      description:
        "Profile a table: row count and, per column, distinct count, NULL count, MIN and MAX. " +
        "Without columns every column is profiled, which scans the whole table on its backend. " +
        "min/max are null for a column whose type the backend cannot order.",
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

        const stats = await profile(db, quotedName(t), columns ?? known);
        return json({ table: t.name, row_count: stats.rowCount, columns: stats.columns });
      }),
  );
}
