import { describe, expect, it } from "vitest";
import { generateProfessionalMaterialDrafts } from "./professionalMaterialGenerator";

describe("generateProfessionalMaterialDrafts", () => {
  it("turns pasted project notes into mode specific material drafts", () => {
    const result = generateProfessionalMaterialDrafts(
      `
视觉伺服闭环里，图像误差和控制增益会共同影响收敛速度。
The adaptive queue should prefer weak targets after repeated mistakes.
const controllerGain = computeGain(errorNorm, maxVelocity);
:%s/oldName/newName/g<Enter>
git status
`,
      "机器人项目",
    );

    expect(result.sourceLength).toBeGreaterThan(0);
    expect(result.drafts.map((draft) => draft.mode)).toEqual([
      "chinese-real",
      "english",
      "code",
      "vim",
    ]);
    expect(result.drafts.find((draft) => draft.mode === "chinese-real")).toMatchObject({
      name: "机器人项目 · 中文真实输入",
      itemCount: 1,
    });
    expect(result.drafts.find((draft) => draft.mode === "english")?.content).toContain(
      "The adaptive queue should prefer weak targets after repeated mistakes",
    );
    expect(result.drafts.find((draft) => draft.mode === "code")?.content).toContain(
      "const controllerGain = computeGain(errorNorm, maxVelocity);",
    );
    expect(result.drafts.find((draft) => draft.mode === "vim")?.content).toContain(
      ":%s/oldName/newName/g<Enter>",
    );
    expect(result.drafts.find((draft) => draft.mode === "vim")?.content).toContain("git status");
  });

  it("deduplicates candidates and limits each generated draft", () => {
    const repeatedLines = Array.from({ length: 30 }, (_, index) =>
      index % 2 === 0
        ? "The local event log keeps training data portable across computers."
        : `const item${index} = queue.slice(${index});`,
    ).join("\n");
    const result = generateProfessionalMaterialDrafts(repeatedLines, "");
    const englishDraft = result.drafts.find((draft) => draft.mode === "english");
    const codeDraft = result.drafts.find((draft) => draft.mode === "code");

    expect(englishDraft?.name).toBe("专业材料 · 英文术语");
    expect(englishDraft?.itemCount).toBe(1);
    expect(codeDraft?.itemCount).toBe(15);
  });

  it("returns no drafts for empty or unusable input", () => {
    expect(generateProfessionalMaterialDrafts("   ").drafts).toEqual([]);
    expect(generateProfessionalMaterialDrafts("a b c").drafts).toEqual([]);
  });
});
