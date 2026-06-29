import { describe, expect, it } from "vitest";
import { twelveWeekPlan, wubiTutorial, wubiTutorialReferences } from "./wubiTutorial";

describe("wubiTutorial curriculum", () => {
  it("ships a complete 12 week training route", () => {
    expect(twelveWeekPlan).toHaveLength(12);
    expect(twelveWeekPlan.map((week) => week.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(twelveWeekPlan.every((week) => week.drills.length >= 3)).toBe(true);
    expect(twelveWeekPlan[0]).toMatchObject({
      title: "安装验收与底座基线",
      drills: expect.arrayContaining(["英文底座 5 轮", "代码底座 5 轮"]),
    });
    expect(twelveWeekPlan.slice(1, 4).map((week) => week.title)).toEqual([
      "英文速度底座",
      "代码符号",
      "Vim 与命令",
    ]);
    expect(twelveWeekPlan[4].title).toBe("字根与键位");
  });

  it("covers the required wubi training topics", () => {
    const ids = wubiTutorial.map((section) => section.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "rime-setup",
        "roots",
        "split",
        "identifier",
        "phrases",
        "personal-dictionary",
        "real-input",
        "workflow",
      ]),
    );
  });

  it("links the tutorial to importable rime wubi sources", () => {
    expect(wubiTutorial.length).toBeGreaterThanOrEqual(12);
    expect(wubiTutorialReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://github.com/rime/rime-wubi" }),
        expect.objectContaining({ url: "https://github.com/KyleBing/rime-wubi86-jidian" }),
      ]),
    );
  });
});
