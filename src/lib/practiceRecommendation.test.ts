import { describe, expect, it } from "vitest";
import type { ExerciseItem, SessionMetrics, TrainingMode, TrainingSession } from "../types";
import { buildNextPracticeRecommendation } from "./practiceRecommendation";

const metrics: SessionMetrics = {
  charsPerMinute: 85,
  accuracy: 98,
  backspaces: 1,
  backspacePer100Chars: 4,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  correctUnits: 10,
  totalUnits: 10,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
  weakTargets: [],
  errorPositions: [],
};

function item(
  id: string,
  mode: TrainingMode,
  targetText: string,
  difficulty: ExerciseItem["difficulty"] = 2,
): ExerciseItem {
  return {
    id,
    mode,
    prompt: "完成下一组训练",
    targetText,
    category: "测试材料",
    tags: ["test"],
    difficulty,
    source: "test",
    contentHash: id,
  };
}

function session(index: number, mode: TrainingMode, overrides: Partial<SessionMetrics> = {}): TrainingSession {
  const startedAt = new Date(Date.UTC(2026, 5, index + 1, 8, 0, 0)).toISOString();
  return {
    id: `${mode}-${index}`,
    deviceId: "device",
    mode,
    itemId: `${mode}-item`,
    targetText: `${mode} target`,
    inputText: `${mode} target`,
    startedAt,
    endedAt: startedAt,
    durationMs: 60000,
    metrics: {
      ...metrics,
      ...overrides,
    },
  };
}

function foundationSessions(): TrainingSession[] {
  return [
    ...Array.from({ length: 20 }, (_, index) => session(index, "english")),
    ...Array.from({ length: 20 }, (_, index) => session(index, "code")),
  ];
}

function sessionForItem(
  id: string,
  mode: TrainingMode,
  itemId: string,
  targetText: string,
  startedAt: string,
): TrainingSession {
  return {
    ...session(0, mode),
    id,
    itemId,
    targetText,
    inputText: targetText,
    startedAt,
    endedAt: startedAt,
  };
}

describe("buildNextPracticeRecommendation", () => {
  it("recommends code after english gates pass but code gates are still open", () => {
    const sessions = Array.from({ length: 5 }, (_, index) => session(index, "english"));
    const recommendation = buildNextPracticeRecommendation(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
      ],
      sessions,
      "english",
    );

    expect(recommendation).toMatchObject({
      mode: "code",
      source: "protocol",
      entry: {
        item: {
          id: "code-next",
        },
      },
    });
  });

  it("falls back to the current mode when the protocol mode has no material", () => {
    const sessions = Array.from({ length: 5 }, (_, index) => session(index, "english"));
    const recommendation = buildNextPracticeRecommendation(
      [item("english-next", "english", "offline first training")],
      sessions,
      "english",
    );

    expect(recommendation).toMatchObject({
      mode: "english",
      source: "current-mode",
      entry: {
        item: {
          id: "english-next",
        },
      },
    });
  });

  it("uses the provided evaluation time when ranking the next adaptive item", () => {
    const sessions = [
      ...Array.from({ length: 5 }, (_, index) => session(index, "english")),
      sessionForItem(
        "old-code-session",
        "code",
        "code-old",
        "const oldTarget = 80;",
        "2026-06-01T08:00:00.000Z",
      ),
      sessionForItem(
        "recent-code-session",
        "code",
        "code-recent",
        "const recentTarget = 80;",
        "2026-06-10T07:59:00.000Z",
      ),
    ];
    const recommendation = buildNextPracticeRecommendation(
      [
        item("code-old", "code", "const oldTarget = 80;", 1),
        item("code-recent", "code", "const recentTarget = 80;", 5),
      ],
      sessions,
      "english",
      { now: new Date("2026-06-10T08:00:00.000Z") },
    );

    expect(recommendation).toMatchObject({
      mode: "code",
      source: "protocol",
      entry: {
        item: {
          id: "code-old",
        },
        reasons: expect.arrayContaining(["间隔复习"]),
      },
    });
  });

  it("recommends wubi after the english and code foundation is ready", () => {
    const sessions = foundationSessions();
    const recommendation = buildNextPracticeRecommendation(
      [
        item("code-next", "code", "const targetCpm = 80;"),
        item("wubi-next", "wubi-code", "中"),
      ],
      sessions,
      "code",
    );

    expect(recommendation).toMatchObject({
      mode: "wubi-code",
      source: "protocol",
      entry: {
        item: {
          id: "wubi-next",
        },
      },
    });
  });
});
