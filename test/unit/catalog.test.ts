import { describe, expect, it } from "vitest";
import { buildCatalog, type CatalogRows, findTable, parseMirrorName, quotedName } from "../../src/common/catalog.js";
import { likePatternToRegex } from "../../src/tools/metadata/search-objects.js";

// rows as the quick_start OtterStax answers them, plus a local database and the kafka bookkeeping tables
const rows: CatalogRows = {
  namespaces: [
    { oid: 1, nspname: "pg_catalog" },
    { oid: 2, nspname: "public" },
    { oid: 3, nspname: "information_schema" },
    { oid: 16384, nspname: "sales" },
    { oid: 16393, nspname: "pgshop" },
    { oid: 16437, nspname: "qs" },
    { oid: 16500, nspname: "kafka" },
  ],
  classes: [
    { oid: 10, relname: "pg_namespace", relnamespace: 1, relkind: "r" },
    { oid: 16385, relname: "__otterstax_tables", relnamespace: 16384, relkind: "r" },
    { oid: 16387, relname: "ops::orders", relnamespace: 16384, relkind: "r" },
    { oid: 16394, relname: "__otterstax_tables", relnamespace: 16393, relkind: "r" },
    { oid: 16396, relname: "shop:shop:customers", relnamespace: 16393, relkind: "r" },
    { oid: 16438, relname: "regions", relnamespace: 16437, relkind: "r" },
    { oid: 16442, relname: "regions_name", relnamespace: 16437, relkind: "i" },
    { oid: 16450, relname: "loose", relnamespace: 0, relkind: "r" },
    { oid: 16501, relname: "__sources", relnamespace: 16500, relkind: "r" },
    { oid: 16502, relname: "orders__offsets", relnamespace: 16500, relkind: "r" },
    { oid: 16503, relname: "orders", relnamespace: 16500, relkind: "r" },
    { oid: 16504, relname: "orders_paid", relnamespace: 16500, relkind: "v" },
  ],
  attributes: [
    { attoid: 1, attrelid: 16387, attname: "status", atttypid: 33, attnum: 2, attnotnull: false, attisdropped: false, atttypspec: "" },
    { attoid: 2, attrelid: 16387, attname: "order_id", atttypid: 27, attnum: 1, attnotnull: true, attisdropped: false, atttypspec: "" },
    { attoid: 3, attrelid: 16387, attname: "gone", atttypid: 33, attnum: 3, attnotnull: false, attisdropped: true, atttypspec: "" },
    { attoid: 4, attrelid: 16387, attname: "amount", atttypid: 41, attnum: 4, attnotnull: false, attisdropped: false, atttypspec: "decimal(10,2)" },
    { attoid: 16440, attrelid: 16438, attname: "name", atttypid: 33, attnum: 1, attnotnull: false, attisdropped: false, atttypspec: null },
  ],
  types: [
    { oid: 27, typname: "int8" },
    { oid: 27, typname: "bigint" },
    { oid: 33, typname: "string" },
    { oid: 33, typname: "text" },
    { oid: 33, typname: "varchar" },
    { oid: 41, typname: "numeric" },
  ],
  indexes: [{ indexrelid: 16442, indrelid: 16438, indkey: "16440" }],
};

const catalog = buildCatalog(rows);

describe("buildCatalog", () => {
  it("marks namespaces holding the manifest as connections and adds default", () => {
    expect(catalog.databases).toEqual([
      { name: "default", kind: "local" },
      { name: "kafka", kind: "local" },
      { name: "pgshop", kind: "connection" },
      { name: "qs", kind: "local" },
      { name: "sales", kind: "connection" },
    ]);
  });

  it("names tables the way SQL resolves them and hides bookkeeping rows", () => {
    expect(catalog.tables.map((t) => [t.name, t.type])).toEqual([
      ["kafka.orders", "table"],
      ["kafka.orders_paid", "view"],
      ["loose", "table"],
      ["pgshop.shop.shop.customers", "table"],
      ["qs.regions", "table"],
      ["sales.ops.orders", "table"],
    ]);
  });

  it("lists live columns in attnum order with SQL-standard type names", () => {
    expect(catalog.columns(findTable(catalog, "sales.ops.orders"))).toEqual([
      { name: "order_id", type: "bigint", nullable: false },
      { name: "status", type: "text", nullable: true },
      { name: "amount", type: "decimal(10,2)", nullable: true },
    ]);
  });

  it("resolves index keys (attoids) to column names", () => {
    expect(catalog.indexes(findTable(catalog, "qs.regions"))).toEqual([{ name: "regions_name", columns: ["name"] }]);
  });

  it("quotes every part of a table name", () => {
    expect(quotedName(findTable(catalog, "pgshop.shop.shop.customers"))).toBe('"pgshop"."shop"."shop"."customers"');
    expect(quotedName(findTable(catalog, "loose"))).toBe('"loose"');
  });

  it("refuses an unknown table", () => {
    expect(() => findTable(catalog, "sales.ops.nope")).toThrow(/not found/);
  });
});

describe("parseMirrorName", () => {
  it("splits <db>:<schema>:<table>", () => {
    expect(parseMirrorName("ops::orders")).toEqual({ db: "ops", schema: "", table: "orders" });
    expect(parseMirrorName("shop:shop:customers")).toEqual({ db: "shop", schema: "shop", table: "customers" });
    expect(parseMirrorName("plain")).toBeNull();
  });
});

describe("likePatternToRegex", () => {
  it("translates % and _ and is case-insensitive", () => {
    expect(likePatternToRegex("%cust%").test("Customers")).toBe(true);
    expect(likePatternToRegex("ord_rs").test("orders")).toBe(true);
    expect(likePatternToRegex("a.b").test("axb")).toBe(false);
  });
});
