// pg_attribute.atttypspec carries the full type of ARRAY/DECIMAL/STRUCT/ENUM/...
// columns in the engine's flat grammar (otterbrix/components/catalog/system_table_schemas.cpp):
//   scalar | numeric(w,s) | UNKNOWN(name) | LIST(inner) | ARRAY(inner,size) | MAP(key,val)
//   STRUCT(name,f1:t1,...) | UNION(f1:t1,...) | VARIANT | ENUM:name:label=val,...
// with \ escaping ( ) , : = \ inside names. Rendered as SQL-like text for the agent.

// pg_type / spec scalar names → the SQL-standard ones
export const STANDARD_NAMES = new Map([
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

const SPECIAL = new Set(["\\", "(", ")", ",", ":", "="]);

class Reader {
  pos = 0;
  constructor(readonly s: string) {}

  // a name up to the next unescaped special character
  name(): string {
    let out = "";
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === "\\") {
        out += this.s[this.pos + 1] ?? "";
        this.pos += 2;
      } else if (SPECIAL.has(c)) {
        break;
      } else {
        out += c;
        this.pos++;
      }
    }
    return out;
  }

  expect(c: string): void {
    if (this.s[this.pos] !== c) throw new Error(`expected '${c}' at ${this.pos}`);
    this.pos++;
  }

  peek(): string | undefined {
    return this.s[this.pos];
  }
}

function parseType(r: Reader): string {
  const keyword = r.name();
  if (r.peek() !== "(") {
    if (keyword === "VARIANT") return "variant";
    return STANDARD_NAMES.get(keyword) ?? keyword;
  }
  r.expect("(");
  let out: string;
  switch (keyword) {
    case "numeric": {
      const width = r.name();
      r.expect(",");
      out = `numeric(${width},${r.name()})`;
      break;
    }
    case "UNKNOWN":
      out = r.name();
      break;
    case "LIST":
      out = `${parseType(r)}[]`;
      break;
    case "ARRAY": {
      const inner = parseType(r);
      r.expect(",");
      out = `${inner}[${r.name()}]`;
      break;
    }
    case "MAP": {
      const key = parseType(r);
      r.expect(",");
      out = `MAP(${key}, ${parseType(r)})`;
      break;
    }
    case "STRUCT": {
      const name = r.name();
      const fields = r.peek() === "," ? (r.expect(","), parseFields(r)) : [];
      out = `${name ? `${name} ` : ""}STRUCT(${fields.join(", ")})`;
      break;
    }
    case "UNION":
      out = `UNION(${parseFields(r).join(", ")})`;
      break;
    default:
      throw new Error(`unknown type keyword '${keyword}'`);
  }
  r.expect(")");
  return out;
}

function parseFields(r: Reader): string[] {
  const fields: string[] = [];
  for (;;) {
    const name = r.name();
    r.expect(":");
    fields.push(`${name} ${parseType(r)}`);
    if (r.peek() !== ",") return fields;
    r.expect(",");
  }
}

function sqlString(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

function parseEnum(r: Reader): string {
  r.pos = "ENUM:".length;
  const name = r.name();
  r.expect(":");
  const labels: string[] = [];
  while (r.pos < r.s.length) {
    labels.push(r.name());
    r.expect("=");
    r.name(); // the stored value; labels are what SQL compares against
    if (r.pos < r.s.length) r.expect(",");
  }
  return `${name} ENUM(${labels.map(sqlString).join(",")})`;
}

export function renderTypeSpec(spec: string): string {
  try {
    const r = new Reader(spec);
    const out = spec.startsWith("ENUM:") ? parseEnum(r) : parseType(r);
    if (r.pos !== spec.length) throw new Error("trailing input");
    return out;
  } catch {
    return spec;
  }
}
