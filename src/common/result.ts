import type { CallToolResult } from "@modelcontextprotocol/server";
import type pg from "pg";

export function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

// {columns, rows: [[...]], row_count}; row_count is the driver's rowCount,
// i.e. rows returned for a SELECT and rows affected for INSERT/UPDATE/DELETE.
export function queryResult(r: pg.QueryArrayResult): CallToolResult {
  return json({
    columns: r.fields.map((f) => f.name),
    rows: r.rows,
    row_count: r.rowCount ?? r.rows.length,
  });
}

const CRASH_HINT =
  "The connection to OtterStax was lost: the engine is down or the query crashed it. " +
  "Recreate the OtterStax process/container fresh (a plain restart can crash-loop on WAL replay); " +
  "the next call reconnects automatically. Retry the query in a simpler shape.";

// pg's messages for a socket that died under it; a refused connection is the engine being down
const CONNECTION_LOST = /Connection terminated|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up/;

export function isConnectionLost(e: unknown): boolean {
  const err = e as { message?: string; code?: string };
  return CONNECTION_LOST.test(String(err.message ?? e)) || CONNECTION_LOST.test(String(err.code));
}

export function errorResult(e: unknown): CallToolResult {
  const err = e as { message?: string; code?: string };
  const message = String(err.message ?? e);
  const lost = isConnectionLost(e);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: lost ? `${message}. ${CRASH_HINT}` : message, code: err.code ?? null }),
      },
    ],
  };
}

export async function run(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    return errorResult(e);
  }
}
