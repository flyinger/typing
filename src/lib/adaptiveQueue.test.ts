import { describe, expect, it } from "vitest";
import type { ExerciseItem, SessionMetrics, TrainingSession } from "../types";
import { buildAdaptiveQueue } from "./adaptiveQueue";

const baseMetrics: SessionMetrics = {
  charsPerMinute: 60,
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
};

function item(id: string, targetText: string, difficulty = 2): ExerciseItem {
  return {
    id,
    mode: "wubi-code",
    prompt: "输入五笔编码",
    targetText,
    expectedCodes: ["abcd"],
    category: "五笔编码",
    tags: ["test"],
    difficulty: difficulty as 1 | 2 | 3 | 4 | 5,
    source: "test",
    contentHash: id,
  };
}

function session(
  id: string,
  targetText: string,
  startedAt: string,
  metrics: Partial<SessionMetrics>,
): TrainingSession {
  return {
    id,
    deviceId: "device",
    mode: "wubi-code",
    itemId: id,
    targetText,
    inputText: targetText,
    startedAt,
    endedAt: startedAt,
    durationMs: 60000,
    metrics: {
      ...baseMetrics,
      ...metrics,
    },
  };
}

describe("buildAdaptiveQueue", () => {
  it("prioritizes recent mistakes and hint-heavy items", () => {
    const now = new Date("2026-06-25T12:00:00.000Z");
    const weak = item("weak", "器械", 2);
    const stable = item("stable", "我们", 1);
    const fresh = item("fresh", "同步", 2);

    const queue = buildAdaptiveQueue(
      [stable, weak, fresh],
      [
        session("weak", "器械", "2026-06-25T08:00:00.000Z", {
          accuracy: 50,
          hintCount: 2,
          hintUsed: true,
          backspaces: 3,
          backspacePer100Chars: 75,
          pauseCountOver1500Ms: 2,
          weakTargets: ["械"],
        }),
        session("weak", "器械", "2026-06-24T08:00:00.000Z", {
          accuracy: 75,
          hintCount: 1,
          hintUsed: true,
          weakTargets: ["器"],
        }),
        session("stable", "我们", "2026-06-25T11:50:00.000Z", {}),
      ],
      "wubi-code",
      { now },
    );

    expect(queue[0].item.id).toBe("weak");
    expect(queue[0].reasons).toContain("近期重复错误");
    expect(queue.at(-1)?.item.id).toBe("stable");
  });

  it("matches history by target text when item ids changed after sync", () => {
    const queue = buildAdaptiveQueue(
      [item("new-id", "视觉伺服")],
      [
        session("old-id", "视觉伺服", "2026-06-23T08:00:00.000Z", {
          accuracy: 80,
          weakTargets: ["伺"],
        }),
      ],
      "wubi-code",
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );

    expect(queue[0]).toMatchObject({
      practiceCount: 1,
      reasons: expect.arrayContaining(["准确率不足", "间隔复习"]),
    });
  });

  it("filters candidates by training mode", () => {
    const wubi = item("wubi", "输入");
    const english: ExerciseItem = {
      ...item("english", "offline first"),
      mode: "english",
      expectedCodes: undefined,
      category: "英文/术语",
    };

    const queue = buildAdaptiveQueue([wubi, english], [], "english", {
      now: new Date("2026-06-25T12:00:00.000Z"),
    });

    expect(queue.map((entry) => entry.item.id)).toEqual(["english"]);
  });
});
