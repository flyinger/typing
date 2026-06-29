import { describe, expect, it } from "vitest";
import type { MaterialPack, TrainingSession } from "../types";
import { filterMaterialPacks, summarizeMaterialPacks } from "./materials";

const material: MaterialPack = {
  id: "pack1",
  name: "专业词",
  description: "机器人专业词",
  version: 1,
  source: "custom.txt",
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z",
  contentHash: "hash",
  items: [
    {
      id: "item1",
      mode: "wubi-code",
      prompt: "输入五笔编码",
      targetText: "器械",
      expectedCodes: ["kkaw"],
      category: "专业词",
      tags: ["robotics"],
      difficulty: 3,
      source: "custom.txt",
      contentHash: "itemhash",
    },
  ],
};

describe("material helpers", () => {
  it("summarizes usage and delete safety", () => {
    const sessions = [
      {
        id: "s1",
        deviceId: "d1",
        mode: "wubi-code",
        materialId: "pack1",
        itemId: "item1",
        targetText: "器械",
        inputText: "kkaw",
        startedAt: "2026-06-25T00:00:00.000Z",
        endedAt: "2026-06-25T00:00:03.000Z",
        durationMs: 3000,
        metrics: {
          charsPerMinute: 20,
          accuracy: 100,
          backspaces: 0,
          backspacePer100Chars: 0,
          pauseCountOver1500Ms: 0,
          maxPauseMs: 0,
          correctUnits: 4,
          totalUnits: 4,
          hintUsed: false,
          hintCount: 0,
          compositionEventCount: 0,
          wrongKeys: [],
          weakTargets: [],
          errorPositions: [],
        },
      },
    ] satisfies TrainingSession[];

    expect(summarizeMaterialPacks([material], sessions)[0]).toMatchObject({
      usedSessionCount: 1,
      canDelete: false,
      modes: ["wubi-code"],
    });
  });

  it("filters by query, source, and mode", () => {
    expect(filterMaterialPacks([material], { query: "器械", mode: "all", source: "all" })).toHaveLength(1);
    expect(filterMaterialPacks([material], { query: "", mode: "english", source: "all" })).toHaveLength(0);
    expect(filterMaterialPacks([material], { query: "", mode: "all", source: "builtin" })).toHaveLength(0);
  });
});
