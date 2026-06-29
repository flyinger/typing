import { describe, expect, it } from "vitest";
import { buildPracticeCursorInfo, formatPracticeKey } from "./practiceTargetDisplay";

describe("practice target display", () => {
  it("formats the next key for visible practice feedback", () => {
    expect(formatPracticeKey("a")).toBe("a");
    expect(formatPracticeKey(" ")).toBe("␠");
    expect(formatPracticeKey("\n")).toBe("Enter");
    expect(formatPracticeKey("\t")).toBe("Tab");
    expect(formatPracticeKey(undefined)).toBe("完成");
  });

  it("summarizes current word, position, remaining units, and errors", () => {
    expect(buildPracticeCursorInfo("append only event log", "append x")).toEqual({
      nextKeyLabel: "n",
      contextLabel: "only",
      positionLabel: "1:9",
      remainingUnits: 13,
      errorUnits: 1,
      extraUnits: 0,
    });
  });

  it("tracks line and column for multiline code drills", () => {
    expect(buildPracticeCursorInfo("const x = 1;\nreturn x;", "const x = 1;\nret")).toMatchObject({
      nextKeyLabel: "u",
      contextLabel: "return",
      positionLabel: "2:4",
      remainingUnits: 6,
      errorUnits: 0,
      extraUnits: 0,
    });
  });

  it("reports extra input beyond the target", () => {
    expect(buildPracticeCursorInfo("abc", "abcd")).toMatchObject({
      nextKeyLabel: "完成",
      remainingUnits: 0,
      errorUnits: 1,
      extraUnits: 1,
    });
  });
});
