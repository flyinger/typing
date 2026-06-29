import { describe, expect, it } from "vitest";
import { createMaterialPackFromText, parseTextMaterialLine } from "./materialImport";

describe("parseTextMaterialLine", () => {
  it("parses plain non-wubi lines as target text", () => {
    expect(parseTextMaterialLine("offline first typing", "english")).toEqual({
      targetText: "offline first typing",
    });
  });

  it("parses custom wubi target and codes from tab separated text", () => {
    expect(parseTextMaterialLine("器械\tkkaw kkag", "wubi-code")).toEqual({
      targetText: "器械",
      expectedCodes: ["kkaw", "kkag"],
    });
  });

  it("parses custom wubi target and codes from comma separated text", () => {
    expect(parseTextMaterialLine("视觉伺服,pywx/wwfy", "wubi-code")).toEqual({
      targetText: "视觉伺服",
      expectedCodes: ["pywx", "wwfy"],
    });
  });

  it("rejects wubi lines without a valid code", () => {
    expect(parseTextMaterialLine("器械", "wubi-code")).toBeNull();
    expect(parseTextMaterialLine("器械\t1234", "wubi-code")).toBeNull();
    expect(parseTextMaterialLine("器械,abc123", "wubi-code")).toBeNull();
  });
});

describe("createMaterialPackFromText", () => {
  it("creates a wubi material pack from pasted text", async () => {
    const pack = await createMaterialPackFromText({
      name: "机器人专业词",
      mode: "wubi-code",
      source: "manual",
      content: "器械\tkkaw kkag\n视觉伺服,pywx/wwfy",
    });

    expect(pack.name).toBe("机器人专业词");
    expect(pack.source).toBe("manual");
    expect(pack.contentHash).toHaveLength(64);
    expect(pack.items).toHaveLength(2);
    expect(pack.items[0]).toMatchObject({
      mode: "wubi-code",
      targetText: "器械",
      expectedCodes: ["kkaw", "kkag"],
      category: "五笔编码",
      tags: ["imported", "wubi-code"],
    });
    expect(pack.items[0].contentHash).toHaveLength(64);
  });

  it("respects import limits after dropping blank lines", async () => {
    const pack = await createMaterialPackFromText({
      name: "英文术语",
      mode: "english",
      source: "manual",
      content: "\noffline first\nappend only\nconflict free\n",
      limit: 2,
    });

    expect(pack.items.map((item) => item.targetText)).toEqual([
      "offline first",
      "append only",
    ]);
  });

  it("rejects empty drafts", async () => {
    await expect(
      createMaterialPackFromText({
        name: "",
        mode: "chinese-real",
        source: "manual",
        content: "有效内容",
      }),
    ).rejects.toThrow("材料包名称不能为空");

    await expect(
      createMaterialPackFromText({
        name: "空内容",
        mode: "chinese-real",
        source: "manual",
        content: "   ",
      }),
    ).rejects.toThrow("材料内容不能为空");
  });

  it("rejects wubi material drafts that do not contain target-code pairs", async () => {
    await expect(
      createMaterialPackFromText({
        name: "无效五笔",
        mode: "wubi-code",
        source: "manual",
        content: "器械\n视觉伺服\t1234",
      }),
    ).rejects.toThrow("每行需要目标字词和至少一个有效字母编码");
  });
});
