import type { ExerciseItem, TrainingSession } from "../types";
import { buildAdaptiveQueue } from "./adaptiveQueue";
import {
  estimateTrainingRounds,
  type TodayTrainingQueueItem,
  type TrainingQueueCoverageIssue,
} from "./todayRecommendations";
import type { WeeklyTrainingPlanItem } from "./weeklyReview";

export interface WeeklyPlanQueueOptions {
  limit?: number;
  now?: Date;
}

export function buildWeeklyPlanTrainingQueue(
  items: ExerciseItem[],
  sessions: TrainingSession[],
  planItem: WeeklyTrainingPlanItem,
  options: WeeklyPlanQueueOptions = {},
): TodayTrainingQueueItem[] {
  const expectedRounds = estimateTrainingRounds(planItem.minutesPerSession, planItem.mode);
  const entries = buildAdaptiveQueue(items, sessions, planItem.mode, {
    limit: options.limit ?? expectedRounds,
    now: options.now,
  });
  const missingRounds = Math.max(0, expectedRounds - entries.length);

  return entries.map((entry, index) => ({
    item: entry.item,
    mode: entry.item.mode,
    role: "primary",
    reason: "周计划",
    adaptiveReasons: entry.reasons,
    score: entry.score,
    planStepId: planItem.id,
    planTitle: planItem.title,
    plannedMinutes: planItem.minutesPerSession,
    planGoal: planItem.goal,
    planRound: index + 1,
    planRoundCount: expectedRounds,
    planExpectedRoundCount: expectedRounds,
    planMissingRoundCount: missingRounds,
  }));
}

export function summarizeWeeklyPlanQueueCoverage(
  planItem: WeeklyTrainingPlanItem,
  queue: TodayTrainingQueueItem[],
): TrainingQueueCoverageIssue[] {
  const expectedRounds = estimateTrainingRounds(planItem.minutesPerSession, planItem.mode);
  const actualRounds = queue.filter((entry) => entry.planStepId === planItem.id).length;
  const missingRounds = Math.max(0, expectedRounds - actualRounds);
  if (missingRounds === 0) return [];
  return [
    {
      planStepId: planItem.id,
      planTitle: planItem.title,
      mode: planItem.mode,
      expectedRounds,
      actualRounds,
      missingRounds,
    },
  ];
}
