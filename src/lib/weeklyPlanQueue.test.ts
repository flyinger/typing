import { describe, expect, it } from "vitest";
import type { ExerciseItem, SessionMetrics, TrainingMode, TrainingSession } from "../types";
import type { WeeklyTrainingPlanItem } from "./weeklyReview";
import {
  buildWeeklyPlanTrainingQueue,
  summarizeWeeklyPlanQueueCoverage,
} from "./weeklyPlanQueue";

const baseMetrics: SessionMetrics = {
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

const englishPlan: WeeklyTrainingPlanItem = {
  id: "english-baseline",
  mode: "english",
  title: "英文速度底座",
  minutesPerSession: 8,
  sessionsPerWeek: 5,
  weeklyMinutes: 40,
  goal: "先把英文技术短句推到 80-100 CPM。",
  acceptance: "新增 >=5 轮英文。",
};

function item(id: string, mode: TrainingMode, targetText: string, difficulty: ExerciseItem["difficulty"] = 2): ExerciseItem {
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

function session(
  id: string,
  mode: TrainingMode,
  itemId: string,
  targetText: string,
  metrics: Partial<SessionMetrics> = {},
): TrainingSession {
  return {
    id,
    deviceId: "device",
    mode,
    itemId,
    targetText,
    inputText: targetText,
    startedAt: "2026-06-25T08:00:00.000Z",
    endedAt: "2026-06-25T08:01:00.000Z",
    durationMs: 60000,
    metrics: {
      ...baseMetrics,
      ...metrics,
    },
  };
}

describe("buildWeeklyPlanTrainingQueue", () => {
  it("builds a short adaptive practice queue for a weekly plan item", () => {
    const queue = buildWeeklyPlanTrainingQueue(
      [
        item("english-stable", "english", "offline first training"),
        item("english-weak", "english", "append only event logs"),
        item("code-next", "code", "const targetCpm = 80;"),
      ],
      [
        session("weak-1", "english", "english-weak", "append only event logs", {
          accuracy: 82,
          weakTargets: ["append"],
        }),
        session("weak-2", "english", "english-weak", "append only event logs", {
          accuracy: 88,
          weakTargets: ["logs"],
        }),
      ],
      englishPlan,
      { limit: 2, now: new Date("2026-06-26T08:00:00.000Z") },
    );

    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      item: {
        id: "english-weak",
      },
      mode: "english",
      role: "primary",
      reason: "周计划",
      planStepId: "english-baseline",
      planTitle: "英文速度底座",
      plannedMinutes: 8,
      planGoal: "先把英文技术短句推到 80-100 CPM。",
      planRound: 1,
      planRoundCount: 4,
      planExpectedRoundCount: 4,
      planMissingRoundCount: 2,
    });
    expect(queue[0].adaptiveReasons).toEqual(expect.arrayContaining(["准确率不足", "近期重复错误"]));
    expect(queue.map((entry) => entry.mode)).toEqual(["english", "english"]);
  });

  it("uses the weekly plan minutes to choose the default queue length", () => {
    const queue = buildWeeklyPlanTrainingQueue(
      [
        item("english-1", "english", "offline first training"),
        item("english-2", "english", "append only event logs"),
        item("english-3", "english", "local sync folder"),
        item("english-4", "english", "foundation sprint"),
        item("english-5", "english", "typing metrics"),
      ],
      [],
      englishPlan,
      { now: new Date("2026-06-26T08:00:00.000Z") },
    );

    expect(queue).toHaveLength(4);
    expect(queue.map((entry) => entry.planRound)).toEqual([1, 2, 3, 4]);
    expect(queue.every((entry) => entry.planRoundCount === 4)).toBe(true);
    expect(queue.every((entry) => entry.planMissingRoundCount === 0)).toBe(true);
  });

  it("reports weekly plan material shortfalls", () => {
    const queue = buildWeeklyPlanTrainingQueue(
      [
        item("english-1", "english", "offline first training"),
      ],
      [],
      englishPlan,
      { now: new Date("2026-06-26T08:00:00.000Z") },
    );

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      planRound: 1,
      planRoundCount: 4,
      planMissingRoundCount: 3,
    });
    expect(summarizeWeeklyPlanQueueCoverage(englishPlan, queue)).toEqual([
      {
        planStepId: "english-baseline",
        planTitle: "英文速度底座",
        mode: "english",
        expectedRounds: 4,
        actualRounds: 1,
        missingRounds: 3,
      },
    ]);
  });

  it("returns an empty queue when the weekly plan mode has no material", () => {
    const queue = buildWeeklyPlanTrainingQueue(
      [item("code-next", "code", "const targetCpm = 80;")],
      [],
      englishPlan,
    );

    expect(queue).toEqual([]);
  });
});
