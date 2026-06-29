import { describe, expect, it } from "vitest";
import type { SessionMetrics, TrainingSession } from "../types";
import { sampleMaterialPacks } from "../data/sampleMaterials";
import { buildPracticePrescription } from "./practicePrescription";
import { buildWeeklyPlanTrainingQueue } from "./weeklyPlanQueue";
import { buildWeeklyReviewReport } from "./weeklyReview";

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

function completedSession(
  targetText: string,
  overrides: Partial<SessionMetrics>,
): TrainingSession {
  return {
    id: "weekly-smoke-session",
    deviceId: "device",
    mode: "english",
    itemId: "weekly-smoke-item",
    targetText,
    inputText: "wrong",
    startedAt: "2026-06-27T08:00:00.000Z",
    endedAt: "2026-06-27T08:00:10.000Z",
    durationMs: 10000,
    metrics: {
      ...baseMetrics,
      ...overrides,
    },
  };
}

describe("weekly plan practice flow", () => {
  it("turns a weekly review plan into a protected practice queue", async () => {
    const allItems = (await sampleMaterialPacks()).flatMap((pack) => pack.items);
    const weeklyReport = buildWeeklyReviewReport([], new Date("2026-06-27T08:00:00.000Z"));
    const englishPlan = weeklyReport.nextWeekPlan[0];

    expect(englishPlan).toMatchObject({
      mode: "english",
      title: "英文速度底座",
      minutesPerSession: 8,
    });

    const queue = buildWeeklyPlanTrainingQueue(allItems, [], englishPlan, {
      now: new Date("2026-06-27T08:00:00.000Z"),
    });

    expect(queue).toHaveLength(4);
    expect(queue[0]).toMatchObject({
      mode: "english",
      reason: "周计划",
      planStepId: "english-baseline",
      planTitle: "英文速度底座",
      plannedMinutes: 8,
      planGoal: "先把英文技术短句推到 80-100 CPM。",
      planRound: 1,
      planRoundCount: 4,
      adaptiveReasons: ["新材料"],
    });

    const failedSession = completedSession(queue[0].item.targetText, {
      accuracy: 0,
      charsPerMinute: 300,
      correctUnits: 0,
      totalUnits: queue[0].item.targetText.length,
      weakTargets: [queue[0].item.targetText],
    });
    const prescription = buildPracticePrescription(failedSession, {
      mode: queue[1].mode,
      targetText: queue[1].item.targetText,
      reasons: queue[1].adaptiveReasons,
    });

    expect(prescription).toMatchObject({
      decision: "retry",
      decisionLabel: "重练当前组",
      canAdvanceQueue: false,
      title: "先修准确率",
    });
    expect(prescription.queueAdvice).toContain("不要推进队列");
    expect(prescription.nextAction).toContain(`达标后再练「${queue[1].item.targetText}」`);
  });
});
