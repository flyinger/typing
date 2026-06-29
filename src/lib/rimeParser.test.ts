import { describe, expect, it } from "vitest";
import { createMaterialPackFromRime, parseRimeDictionary } from "./rimeParser";

describe("parseRimeDictionary", () => {
  it("skips yaml header and parses tab separated entries", () => {
    const entries = parseRimeDictionary(`---
name: wubi86
...
中\tkhk\t100
器械\tkkaw\t80
中\tKH\t20
错码\t1234\t99
# comment
`);

    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.text === "中")?.codes).toEqual(["khk", "kh"]);
    expect(entries.find((entry) => entry.text === "器械")?.weight).toBe(80);
  });

  it("rejects empty or invalid Rime dictionaries when creating a material pack", async () => {
    await expect(
      createMaterialPackFromRime("空词库", "empty.dict.yaml", `---
name: empty
...
# no valid entries
错码\t1234\t1
`),
    ).rejects.toThrow("没有可导入的有效 Rime 五笔词条");
  });
});
