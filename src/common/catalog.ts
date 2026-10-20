// The engine catalog (pg_catalog) turned into what an agent needs: databases,
// tables under the SQL names that resolve, and their columns. The naming rules
// mirror otterstax/frontend/spark_connect_server/catalog_rows.hpp.
import type { Db } from "./db.js";

export const FIRST_USER_OID = 16384;
const MANIFEST = "__otterstax_tables";
const DEFAULT_DATABASE = "default";

export type NamespaceRow = { oid: number; nspname: string };
export type ClassRow = { oid: number; relname: string; relnamespace: number; relkind: string };
export type AttributeRow = {
  attoid: number;
  attrelid: number;
  attname: string;
  atttypid: number;
  attnum: number;
  attnotnull: boolean;
  attisdropped: boolean;
  atttypspec: string | null;
};
export type TypeRow = { oid: number; typname: string };
export type IndexRow = { indexrelid: number; indrelid: number; indkey: string };

export type CatalogRows = {
  namespaces: NamespaceRow[];
  classes: ClassRow[];
  attributes: AttributeRow[];
  types: TypeRow[];
  indexes: IndexRow[];
};

export type Database = { name: string; kind: "connection" | "local" };
export type Column = { name: string; type: string; nullable: boolean };
export type Index = { name: string; columns: string[] };
export type Table = {
  oid: number;
  database: string;
  // path below the database: [db] / [db, schema] for a connection, [] for a local table
  qualifier: string[];
  table: string;
  name: string; // the SQL name, e.g. sales.ops.orders
  type: "table" | "view";
};

export type Catalog = {
  databases: Database[];
  tables: Table[];
  columns(table: Table): Column[];
  indexes(table: Table): Index[];
};

export async function loadCatalog(db: Db): Promise<Catalog> {
  const q = async <T>(sql: string) => (await db.query(sql)).rows as T[];
  // pg_class before pg_namespace, as the Spark frontend reads them: a table whose
  // namespace vanished in between was dropped with it
  const classes = await q<ClassRow>("SELECT oid, relname, relnamespace, relkind FROM pg_catalog.pg_class");
  const namespaces = await q<NamespaceRow>("SELECT oid, nspname FROM pg_catalog.pg_namespace");
  const attributes = await q<AttributeRow>(
    "SELECT attoid, attrelid, attname, atttypid, attnum, attnotnull, attisdropped, atttypspec FROM pg_catalog.pg_attribute",
  );
  const types = await q<TypeRow>("SELECT oid, typname FROM pg_catalog.pg_type");
  const indexes = await q<IndexRow>("SELECT indexrelid, indrelid, indkey FROM pg_catalog.pg_index");
  return buildCatalog({ namespaces, classes, attributes, types, indexes });
}

export function buildCatalog(rows: CatalogRows): Catalog {
  const namespaceNames = new Map(rows.namespaces.map((n) => [Number(n.oid), n.nspname]));
  const mirrors = new Set(
    rows.classes.filter((c) => Number(c.oid) >= FIRST_USER_OID && c.relname === MANIFEST).map((c) => Number(c.relnamespace)),
  );

  const databases: Database[] = [{ name: DEFAULT_DATABASE, kind: "local" }];
  for (const [oid, name] of namespaceNames) {
    if (oid >= FIRST_USER_OID) databases.push({ name, kind: mirrors.has(oid) ? "connection" : "local" });
  }
  databases.sort((a, b) => a.name.localeCompare(b.name));

  const tables: Table[] = [];
  for (const c of rows.classes) {
    const oid = Number(c.oid);
    const nsp = Number(c.relnamespace);
    const type = c.relkind === "r" || c.relkind === "g" ? "table" : c.relkind === "v" || c.relkind === "m" ? "view" : null;
    if (oid < FIRST_USER_OID || type === null || (nsp !== 0 && nsp < FIRST_USER_OID)) continue;
    if (nsp === 0) {
      tables.push({ oid, database: DEFAULT_DATABASE, qualifier: [], table: c.relname, name: c.relname, type });
      continue;
    }
    const database = namespaceNames.get(nsp);
    if (database === undefined) continue;
    if (mirrors.has(nsp)) {
      if (c.relname === MANIFEST) continue;
      const parsed = parseMirrorName(c.relname);
      if (!parsed) continue;
      const qualifier = parsed.schema ? [parsed.db, parsed.schema] : [parsed.db];
      tables.push({ oid, database, qualifier, table: parsed.table, name: [database, ...qualifier, parsed.table].join("."), type });
    } else {
      if (database === "kafka" && (c.relname === "__sources" || c.relname.endsWith("__offsets"))) continue;
      tables.push({ oid, database, qualifier: [], table: c.relname, name: `${database}.${c.relname}`, type });
    }
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));

  const typeNames = sqlTypeNames(rows.types);
  const attributesOf = (oid: number) =>
    rows.attributes
      .filter((a) => Number(a.attrelid) === oid && !a.attisdropped)
      .sort((a, b) => Number(a.attnum) - Number(b.attnum));

  return {
    databases,
    tables,
    columns: (t) =>
      attributesOf(t.oid).map((a) => ({
        name: a.attname,
        // ARRAY / DECIMAL / STRUCT / ENUM carry their full type in atttypspec
        type: a.atttypspec ? a.atttypspec : (typeNames.get(Number(a.atttypid)) ?? String(a.atttypid)),
        nullable: !a.attnotnull,
      })),
    indexes: (t) => {
      const byAttoid = new Map(attributesOf(t.oid).map((a) => [String(a.attoid), a.attname]));
      const relnames = new Map(rows.classes.map((c) => [Number(c.oid), c.relname]));
      return rows.indexes
        .filter((i) => Number(i.indrelid) === t.oid)
        .map((i) => ({
          name: relnames.get(Number(i.indexrelid)) ?? String(i.indexrelid),
          columns: String(i.indkey)
            .split(/[ ,]+/)
            .filter(Boolean)
            .map((k) => byAttoid.get(k) ?? k),
        }));
    },
  };
}

// <db>:<schema>:<table>, the schema empty (<db>::<table>) for MySQL / ClickHouse
export function parseMirrorName(relname: string): { db: string; schema: string; table: string } | null {
  const first = relname.indexOf(":");
  const second = first < 0 ? -1 : relname.indexOf(":", first + 1);
  if (second < 0) return null;
  return { db: relname.slice(0, first), schema: relname.slice(first + 1, second), table: relname.slice(second + 1) };
}

// pg_type lists several names per oid (33 = string, text, varchar, bpchar, name);
// show the SQL-standard one
const STANDARD_NAMES = new Map([
  ["bool", "boolean"],
  ["int1", "tinyint"],
  ["uint1", "utinyint"],
  ["int2", "smallint"],
  ["uint2", "usmallint"],
  ["int4", "integer"],
  ["uint4", "uinteger"],
  ["int8", "bigint"],
  ["uint8", "ubigint"],
  ["int16", "hugeint"],
  ["uint16", "uhugeint"],
  ["float4", "real"],
  ["float8", "double precision"],
  ["string", "text"],
  ["blob", "bytea"],
]);

export function sqlTypeNames(types: TypeRow[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const t of types) {
    const oid = Number(t.oid);
    if (!names.has(oid)) names.set(oid, STANDARD_NAMES.get(t.typname) ?? t.typname);
  }
  return names;
}

export function findTable(catalog: Catalog, name: string): Table {
  const table = catalog.tables.find((t) => t.name === name);
  if (!table) throw new Error(`table '${name}' not found; list_tables shows the available names`);
  return table;
}

// every part double-quoted, as the Spark frontend builds its probes
export function quotedName(t: Table): string {
  const parts = t.database === DEFAULT_DATABASE ? [t.table] : [t.database, ...t.qualifier, t.table];
  return parts.map(quoteIdent).join(".");
}

export function quoteIdent(s: string): string {
  return `"${s.replaceAll('"', '""')}"`;
}
