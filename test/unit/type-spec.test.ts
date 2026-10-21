import { describe, expect, it } from "vitest";
import { renderTypeSpec } from "../../src/common/type-spec.js";

describe("renderTypeSpec", () => {
  it.each([
    // specs as the demo OtterStax stores them
    ["ENUM:tier_t:bronze=0,silver=1,gold=2", "tier_t ENUM('bronze','silver','gold')"],
    ["STRUCT(props_t,channel:text,geo:STRUCT(geo_t,ip:text))", "props_t STRUCT(channel text, geo geo_t STRUCT(ip text))"],
    ["STRUCT(ship_addr_t,country:text,city:text,zip:text)", "ship_addr_t STRUCT(country text, city text, zip text)"],
    // the rest of the grammar
    ["numeric(10,2)", "numeric(10,2)"],
    ["LIST(int8)", "bigint[]"],
    ["ARRAY(float8,3)", "double precision[3]"],
    ["MAP(text,int4)", "MAP(text, integer)"],
    ["UNION(a:int4,b:text)", "UNION(a integer, b text)"],
    ["UNKNOWN(geometry)", "geometry"],
    ["VARIANT", "variant"],
    ["STRUCT(,x:bool)", "STRUCT(x boolean)"],
    // escaped names
    ["ENUM:mood:it\\'s=0,a\\,b=1", "mood ENUM('it''s','a,b')"],
    ["STRUCT(t\\:1,f\\(x\\):text)", "t:1 STRUCT(f(x) text)"],
  ])("%s → %s", (spec, sql) => {
    expect(renderTypeSpec(spec)).toBe(sql);
  });

  it("returns a spec it cannot parse unchanged", () => {
    expect(renderTypeSpec("STRUCT(broken")).toBe("STRUCT(broken");
    expect(renderTypeSpec("FANCY(x)")).toBe("FANCY(x)");
  });
});
