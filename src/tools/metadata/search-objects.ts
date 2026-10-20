// Modelled on DBHub's search_objects (object_type, pattern, detail_level, limit).
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type Catalog, loadCatalog, quotedName, type Table } from "../../common/catalog.js";
import type { Db } from "../../common/db.js";
import { json, run } from "../../common/result.js";

export function likePatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

type DetailLevel = "names" | "summary" | "full";

async function rowCount(db: Db, t: Table): Promise<number | null> {
  try {
    const r = await db.query({ text: `SELECT COUNT(*) FROM ${quotedName(t)}`, rowMode: "array" });
    return Number(r.rows[0][0]);
  } catch {
    return null;
  }
}

async function searchTables(db: Db, catalog: Catalog, regex: RegExp, detail: DetailLevel, limit: number) {
  const matched = catalog.tables.filter((t) => regex.test(t.table)).slice(0, limit);
  return Promise.all(
    matched.map(async (t) => {
      if (detail === "names") return { name: t.name, type: t.type };
      const columns = catalog.columns(t);
      const summary = { name: t.name, type: t.type, column_count: columns.length, row_count: await rowCount(db, t) };
      return detail === "summary" ? summary : { ...summary, columns, indexes: catalog.indexes(t) };
    }),
  );
}

function searchColumns(catalog: Catalog, regex: RegExp, detail: DetailLevel, limit: number) {
  const results = [];
  for (const t of catalog.tables) {
    for (const c of catalog.columns(t)) {
      if (results.length >= limit) return results;
      if (!regex.test(c.name)) continue;
      // summary and full are the same for columns
      results.push(detail === "names" ? { name: c.name, table: t.name } : { ...c, table: t.name });
    }
  }
  return results;
}

export function registerSearchObjects(server: McpServer, db: Db): void {
  server.registerTool(
    "search_objects",
    {
      description:
        "Search tables or columns by name across all databases with a LIKE pattern. " +
        "detail_level: names (minimal), summary (tables: column and row counts; columns: type), " +
        "full (tables: also columns and indexes). summary/full on tables run COUNT(*) on each match.",
      inputSchema: z.object({
        object_type: z.enum(["table", "column"]).describe("Object type to search"),
        pattern: z.string().default("%").describe("LIKE pattern (% = any chars, _ = one char), case-insensitive"),
        detail_level: z.enum(["names", "summary", "full"]).default("names").describe("Detail: names, summary, full"),
        limit: z.number().int().positive().max(1000).default(100).describe("Max results"),
      }),
    },
    ({ object_type, pattern, detail_level, limit }) =>
      run(async () => {
        const catalog = await loadCatalog(db);
        const regex = likePatternToRegex(pattern);
        const results =
          object_type === "table"
            ? await searchTables(db, catalog, regex, detail_level, limit)
            : searchColumns(catalog, regex, detail_level, limit);
        return json({
          object_type,
          pattern,
          detail_level,
          count: results.length,
          results,
          truncated: results.length === limit,
        });
      }),
  );
}
