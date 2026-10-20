import pg from "pg";

export const DEFAULT_URL = "postgresql://localhost:8817";

// The pool replaces a dead connection with a fresh one on the next checkout,
// so a restarted engine is picked up without restarting the MCP server.
export function createPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // an idle client losing its socket must not crash the process
  pool.on("error", () => {});
  return pool;
}

export type Db = Pick<pg.Pool, "query">;
