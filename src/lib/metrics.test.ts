import { describe, expect, it } from "vitest";
import {
  buildTrendPoints,
  calculateAccuracy,
  calculateSessionMetrics,
  calculateStreak,
  chooseBestTargetForInput,
  classifyBurstInput,
  detectBurstInput,
  diffPositions,
  getRecentSessions,
  includeFinalPause,
} from "./metrics";
import type { SessionMetrics, TrainingSession } from "../types";

const baseMetrics: SessionMetrics = {
  charsPerMinute: 80,
  accuracy: 96,
  backspaces: 1,
  backspacePer100Chars: 5,
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

function makeSession(id: string, startedAt: string): TrainingSession {
  return {
    id,
    deviceId: "device-1",
    mode: "english",
    itemId: "item-1",
    targetText: "test",
    inputText: "test",
    startedAt,
    endedAt: startedAt,
    durationMs: 60000,
    metrics: baseMetrics,
  };
}

describe("metrics", () => {
  it("calculates diff positions for replacement and length mismatch", () => {
    expect(diffPositions("abc", "adc")).toEqual([1]);
    expect(diffPositions("abc", "ab")).toEqual([2]);
  });

  it("calculates accuracy and typing metrics", () => {
    expect(calculateAccuracy("中文输入", "中文输出")).toBe(75);
    const metrics = calculateSessionMetrics("abcd", "abxd", 60000, {
      backspaces: 2,
      pauseCountOver1500Ms: 1,
      maxPauseMs: 1800,
      hintCount: 1,
      pasteEventCount: 1,
      compositionEventCount: 3,
      wrongKeys: ["x"],
    });

    expect(metrics.charsPerMinute).toBe(4);
    expect(metrics.accuracy).toBe(75);
    expect(metrics.backspacePer100Chars).toBe(50);
    expect(metrics.hintUsed).toBe(true);
    expect(metrics.pasteEventCount).toBe(1);
    expect(metrics.weakTargets).toEqual(["c"]);
  });

  it("chooses the exact accepted target before scoring multi-code input", () => {
    expect(chooseBestTargetForInput(["trnt", "trn"], "trn")).toBe("trn");
    expect(chooseBestTargetForInput(["khk", "kh"], "khl")).toBe("khk");
  });

  it("detects burst input by inserted length and target size", () => {
    expect(detectBurstInput("abcdefg", "abcdefgh", "abcdefghijklmnop")).toMatchObject({
      detected: false,
      insertedChars: 1,
      threshold: 8,
    });
    expect(detectBurstInput("", "append only event logs", "append only event logs")).toMatchObject({
      detected: true,
      insertedChars: 22,
      threshold: 8,
    });
    expect(detectBurstInput("a", "abcdefg", "abcd")).toMatchObject({
      detected: false,
      insertedChars: 6,
      threshold: 8,
    });
    expect(detectBurstInput("", "x".repeat(40), "x".repeat(100))).toMatchObject({
      detected: true,
      insertedChars: 40,
      threshold: 35,
    });
  });

  it("suppresses burst detection immediately after an explicit paste event", () => {
    expect(classifyBurstInput("", "append only event logs", "append only event logs", false)).toMatchObject({
      detected: true,
      insertedChars: 22,
      suppressedByExplicitPaste: false,
    });
    expect(classifyBurstInput("", "append only event logs", "append only event logs", true)).toMatchObject({
      detected: false,
      insertedChars: 22,
      suppressedByExplicitPaste: true,
    });
    expect(classifyBurstInput("abc", "abcd", "append only event logs", true)).toMatchObject({
      detected: false,
      insertedChars: 1,
      suppressedByExplicitPaste: false,
    });
  });

  it("includes the final pause before completion in pause metrics", () => {
    const counters = {
      backspaces: 0,
      pauseCountOver1500Ms: 1,
      maxPauseMs: 1800,
      hintCount: 0,
      compositionEventCount: 0,
      wrongKeys: [],
    };

    expect(includeFinalPause(counters, 1000, 2400)).toEqual({
      counters,
      finalPauseMs: null,
    });
    expect(includeFinalPause(counters, 1000, 4200)).toEqual({
      counters: {
        ...counters,
        pauseCountOver1500Ms: 2,
        maxPauseMs: 3200,
      },
      finalPauseMs: 3200,
    });
    expect(includeFinalPause(counters, null, 4200)).toEqual({
      counters,
      finalPauseMs: null,
    });
  });

  it("builds trend buckets by local calendar day", () => {
    const localEarlyMorning = new Date(2026, 5, 26, 0, 30).toISOString();
    const trend = buildTrendPoints(
      [makeSession("today", localEarlyMorning)],
      1,
      new Date(2026, 5, 26, 12, 0),
    );

    expect(trend).toEqual([
      expect.objectContaining({
        date: "2026-06-26",
        sessions: 1,
        minutes: 1,
      }),
    ]);
  });

  it("calculates streak by local calendar day", () => {
    const sessions = [
      makeSession("today", new Date(2026, 5, 26, 0, 10).toISOString()),
      makeSession("yesterday", new Date(2026, 5, 25, 23, 50).toISOString()),
    ];

    expect(calculateStreak(sessions, new Date(2026, 5, 26, 12, 0))).toBe(2);
  });

  it("selects recent sessions by startedAt instead of input order", () => {
    const sessions = [
      makeSession("older", "2026-06-20T10:00:00.000Z"),
      makeSession("newest", "2026-06-26T10:00:00.000Z"),
      makeSession("middle", "2026-06-24T10:00:00.000Z"),
    ];

    expect(getRecentSessions(sessions, 2).map((session) => session.id)).toEqual(["newest", "middle"]);
  });
});
