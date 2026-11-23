import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/datasets/csv.js";

describe("parseCsv", () => {
  it("strips a BOM and maps header fields", () => {
    const rows = parseCsv("\uFEFFname,value\na,1\n");
    expect(rows).toEqual([{ name: "a", value: "1" }]);
  });

  it("keeps commas and newlines inside quoted fields", () => {
    const rows = parseCsv(
      'image_filename,description_english\n0002.jpg,"Take two tablets,\nmorning and night"\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description_english).toBe("Take two tablets,\nmorning and night");
  });

  it("unescapes doubled quotes", () => {
    const rows = parseCsv('a,b\n"x""y",z\n');
    expect(rows[0]).toEqual({ a: 'x"y', b: "z" });
  });
});
