import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createPool, DEFAULT_URL } from "./common/db.js";
import { createServer } from "./server.js";

const pool = createPool(process.env.OTTERSTAX_URL || DEFAULT_URL);

serveStdio(() => createServer(pool), {
  onerror: (e) => console.error("otterstax-mcp:", e.message),
});
