import { describe, expect, it } from "vitest";
import type { ExerciseItem, TrainingMode } from "../types";
import { buildFoundationMaterialReadiness } from "./materialReadiness";

function item(id: string, mode: TrainingMode, targetText: string): ExerciseItem {
  return {
    id,
    mode,
    prompt: "输入材料",
    targetText,
    category: "test",
    tags: ["test"],
    difficulty: 2,
    source: "test",
    contentHash: id,
  };
}

describe("buildFoundationMaterialReadiness", () => {
  it("marks english and code ready when each mode has enough 80 CPM capable items", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, index) =>
        item(`english-${index}`, "english", `english foundation phrase number ${index}`),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        item(`code-${index}`, "code", `const foundationValue${index} = computeTarget(${index});`),
      ),
    ];

    const report = buildFoundationMaterialReadiness(items);

    expect(report.ready).toBe(true);
    expect(report.modes.map((mode) => mode.status)).toEqual(["ready", "ready"]);
    expect(report.modes[0]).toMatchObject({
      mode: "english",
      minEffectiveUnits: 16,
      minComfortUnits: 20,
      effectiveItems: 10,
      comfortItems: 10,
    });
  });

  it("flags short foundation material that would not produce an effective sample at 80 CPM", () => {
    const items = [
      item("english-short", "english", "short"),
      item("code-short", "code", "x = 1;"),
    ];

    const report = buildFoundationMaterialReadiness(items);

    expect(report.ready).toBe(false);
    expect(report.modes).toEqual([
      expect.objectContaining({
        mode: "english",
        totalItems: 1,
        effectiveItems: 0,
        missingEffectiveItems: 10,
        status: "empty",
      }),
      expect.objectContaining({
        mode: "code",
        totalItems: 1,
        effectiveItems: 0,
        missingEffectiveItems: 10,
        status: "empty",
      }),
    ]);
  });
});
