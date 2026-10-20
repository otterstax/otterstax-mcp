// End-to-end: spawns dist/index.js over stdio against a live OtterStax
// (otterstax/examples/quick_start, `docker compose up -d`). Run `npm run build` first.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.OTTERSTAX_URL ?? "postgresql://localhost:8817";
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as Array<{ type: string; text: string }>)[0].text;
  return { isError: r.isError === true, body: JSON.parse(text) };
}

async function ok(name: string, args: Record<string, unknown> = {}) {
  const r = await call(name, args);
  expect(r.isError, JSON.stringify(r.body)).toBe(false);
  return r.body;
}

beforeAll(async () => {
  client = new Client({ name: "integration-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { OTTERSTAX_URL: url } }));
});

afterAll(async () => {
  await client?.close();
});

describe("server", () => {
  it("exposes the tools and the instructions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "describe_table",
      "execute_sql",
      "explain_query",
      "list_databases",
      "list_schemas",
      "list_tables",
      "search_objects",
      "table_stats",
    ]);
    expect(client.getInstructions()).toMatch(/federated SQL server/);
  });
});

describe("metadata", () => {
  it("list_databases shows the quick_start connections", async () => {
    const { databases } = await ok("list_databases");
    for (const name of ["pgshop", "pgcat", "sales", "web"]) {
      expect(databases).toContainEqual({ name, kind: "connection" });
    }
  });

  it("list_schemas gives <db>.<schema> for PostgreSQL and <db> for MySQL", async () => {
    expect((await ok("list_schemas", { database: "pgshop" })).schemas).toEqual(["shop.shop"]);
    expect((await ok("list_schemas", { database: "sales" })).schemas).toEqual(["ops"]);
  });

  it("list_tables gives names execute_sql resolves", async () => {
    const { tables } = await ok("list_tables");
    const names = tables.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["sales.ops.orders", "pgshop.shop.shop.customers", "pgcat.catalog.catalog.products", "web.analytics.pageviews"]),
    );
    for (const name of names) {
      await ok("execute_sql", { sql: `SELECT * FROM ${name} LIMIT 1` });
    }
    expect((await ok("list_tables", { database: "web" })).tables).toEqual([{ name: "web.analytics.pageviews", type: "table" }]);
  });

  it("describe_table lists columns with types", async () => {
    const { columns } = await ok("describe_table", { table: "sales.ops.orders" });
    expect(columns).toContainEqual({ name: "amount", type: "double precision", nullable: true });
    expect(columns.map((c: { name: string }) => c.name)).toEqual(["order_id", "customer_id", "product_id", "amount", "status"]);
  });

  it("search_objects finds columns and counts rows of tables", async () => {
    const cols = await ok("search_objects", { object_type: "column", pattern: "%customer%" });
    expect(cols.results).toContainEqual({ name: "customer_id", table: "sales.ops.orders" });
    const tables = await ok("search_objects", { object_type: "table", pattern: "orders", detail_level: "summary" });
    expect(tables.results).toEqual([{ name: "sales.ops.orders", type: "table", column_count: 5, row_count: 1000 }]);
  });
});

describe("profiling", () => {
  it.each(["sales.ops.orders", "pgshop.shop.shop.customers", "pgcat.catalog.catalog.products", "web.analytics.pageviews"])(
    "table_stats profiles %s",
    async (table) => {
      const stats = await ok("table_stats", { table });
      expect(stats.row_count).toBeGreaterThan(0);
      expect(stats.columns.length).toBeGreaterThan(0);
    },
  );

  it("table_stats narrows to the given columns", async () => {
    const stats = await ok("table_stats", { table: "sales.ops.orders", columns: ["status"] });
    expect(stats.columns).toEqual([{ name: "status", distinct: 4, nulls: 0, min: "paid", max: "shipped" }]);
  });
});

describe("query", () => {
  it("runs a federated join across three backends", async () => {
    const r = await ok("execute_sql", {
      sql: `SELECT p.category, c.country, SUM(o.amount) AS revenue
            FROM sales.ops.orders o
            JOIN pgshop.shop.customers c  ON c.customer_id = o.customer_id
            JOIN pgcat.catalog.products p ON p.product_id  = o.product_id
            WHERE o.status IN ('paid','shipped')
            GROUP BY p.category, c.country ORDER BY revenue DESC LIMIT 5`,
    });
    expect(r.columns).toEqual(["category", "country", "revenue"]);
    expect(r.row_count).toBe(5);
  });

  it("runs DDL and DML and reports affected rows", async () => {
    await ok("execute_sql", { sql: "CREATE DATABASE mcp_it" });
    try {
      await ok("execute_sql", { sql: "CREATE TABLE mcp_it.t (id bigint, label string)" });
      expect((await ok("execute_sql", { sql: "INSERT INTO mcp_it.t (id, label) VALUES (1, 'a'), (2, 'b'), (3, 'c')" })).row_count).toBe(3);
      expect((await ok("execute_sql", { sql: "UPDATE mcp_it.t SET label = 'z' WHERE id <= 2" })).row_count).toBe(2);
      expect((await ok("list_tables", { database: "mcp_it" })).tables).toEqual([{ name: "mcp_it.t", type: "table" }]);
    } finally {
      await call("execute_sql", { sql: "DROP TABLE mcp_it.t" });
      await call("execute_sql", { sql: "DROP DATABASE mcp_it" });
    }
  });

  it("returns SQL errors as isError with {error, code}", async () => {
    const r = await call("execute_sql", { sql: "SELECT * FROM nosuch.ops.orders" });
    expect(r.isError).toBe(true);
    expect(r.body).toEqual({ error: expect.any(String), code: "42601" });
  });

  it("explain_query sends EXPLAIN and returns the server's answer", async () => {
    const r = await call("explain_query", { sql: "SELECT * FROM sales.ops.orders" });
    if (r.isError) expect(r.body.error).toMatch(/EXPLAIN/);
    else expect(r.body.columns.length).toBeGreaterThan(0);
  });
});

describe("reconnect", () => {
  it("recovers after the OtterStax container restarts", { timeout: 180_000 }, async () => {
    await ok("execute_sql", { sql: "SELECT 1" });
    execFileSync("docker", ["restart", "qs-otterstax"]);
    let last: unknown;
    for (let i = 0; i < 60; i++) {
      const r = await call("execute_sql", { sql: "SELECT 1" });
      if (!r.isError) return;
      last = r.body;
      await sleep(2000);
    }
    throw new Error(`no recovery: ${JSON.stringify(last)}`);
  });
});
