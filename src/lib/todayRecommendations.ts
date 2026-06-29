import type { ExerciseItem, TrainingMode, TrainingSession } from "../types";
import { buildAdaptiveQueue, type AdaptiveQueueEntry } from "./adaptiveQueue";
import {
  getFoundationReport,
  buildTrainingProtocol,
  type DailyPlanStep,
  type FoundationEvaluationOptions,
} from "./trainingPlan";

export type TodayRecommendationRole = "primary" | "support" | "maintenance";

export interface TodayRecommendation {
  entry: AdaptiveQueueEntry;
  role: TodayRecommendationRole;
  reason: string;
}

export interface TodayTrainingQueueItem {
  item: ExerciseItem;
  mode: TrainingMode;
  role: TodayRecommendationRole;
  reason: string;
  adaptiveReasons: string[];
  score: number;
  planStepId?: string;
  planTitle?: string;
  plannedMinutes?: number;
  planGoal?: string;
  planRound?: number;
  planRoundCount?: number;
  planExpectedRoundCount?: number;
  planMissingRoundCount?: number;
}

export interface TodayRecommendationOptions extends FoundationEvaluationOptions {
  limit?: number;
  perModeLimit?: number;
}

export interface TodayTrainingQueueOptions {
  planSteps?: DailyPlanStep[];
}

export interface TrainingQueueCoverageIssue {
  planStepId: string;
  planTitle: string;
  mode: TrainingMode;
  expectedRounds: number;
  actualRounds: number;
  missingRounds: number;
}

export interface TodayQueueReadinessMode {
  mode: TrainingMode;
  expectedRounds: number;
  actualRounds: number;
  missingRounds: number;
}

export interface TodayQueueReadiness {
  ready: boolean;
  planned: boolean;
  expectedRounds: number;
  actualRounds: number;
  missingRounds: number;
  headline: string;
  detail: string;
  modes: TodayQueueReadinessMode[];
  coverageIssues: TrainingQueueCoverageIssue[];
}

interface ModeSlot {
  mode: TrainingMode;
  role: TodayRecommendationRole;
  reason: string;
  take: number;
}

export function buildTodayRecommendations(
  items: ExerciseItem[],
  sessions: TrainingSession[],
  options: TodayRecommendationOptions = {},
): TodayRecommendation[] {
  const limit = options.limit ?? 18;
  const perModeLimit = options.perModeLimit ?? 3;
  const slots = buildModeSlots(sessions, options);
  const slotSelections: TodayRecommendation[][] = [];
  const seen = new Set<string>();

  for (const slot of slots) {
    const entries = buildAdaptiveQueue(items, sessions, slot.mode, {
      limit: Math.max(slot.take, perModeLimit),
      now: options.now,
    });
    const selectedForSlot: TodayRecommendation[] = [];
    let takenForSlot = 0;
    for (const entry of entries) {
      if (seen.has(entry.item.id)) continue;
      seen.add(entry.item.id);
      selectedForSlot.push({
        entry,
        role: slot.role,
        reason: slot.reason,
      });
      takenForSlot += 1;
      if (takenForSlot >= slot.take) break;
    }
    slotSelections.push(selectedForSlot);
  }

  return interleaveRecommendations(slotSelections, limit);
}

export function buildTodayTrainingQueue(
  recommendations: TodayRecommendation[],
  startIndex = 0,
  options: TodayTrainingQueueOptions = {},
): TodayTrainingQueueItem[] {
  if (recommendations.length === 0) return [];
  const normalizedStartIndex =
    ((Math.trunc(startIndex) % recommendations.length) + recommendations.length) %
    recommendations.length;
  const rotatedRecommendations = [
    ...recommendations.slice(normalizedStartIndex),
    ...recommendations.slice(0, normalizedStartIndex),
  ];
  const planSteps = rotatePlanSteps(
    options.planSteps?.filter((step) => step.minutes > 0) ?? [],
    recommendations[normalizedStartIndex]?.entry.item.mode,
  );

  if (planSteps.length > 0) {
    return buildPlanQueue(planSteps, rotatedRecommendations);
  }

  return rotatedRecommendations.map((recommendation) => ({
    item: recommendation.entry.item,
    mode: recommendation.entry.item.mode,
    role: recommendation.role,
    reason: recommendation.reason,
    adaptiveReasons: recommendation.entry.reasons,
    score: recommendation.entry.score,
  }));
}

function rotatePlanSteps(planSteps: DailyPlanStep[], startMode?: TrainingMode): DailyPlanStep[] {
  if (!startMode || planSteps.length === 0) return planSteps;
  const startIndex = planSteps.findIndex((step) => step.mode === startMode);
  if (startIndex <= 0) return planSteps;
  return [...planSteps.slice(startIndex), ...planSteps.slice(0, startIndex)];
}

function buildPlanQueue(
  planSteps: DailyPlanStep[],
  recommendations: TodayRecommendation[],
): TodayTrainingQueueItem[] {
  const usedIds = new Set<string>();
  const queue: TodayTrainingQueueItem[] = [];

  for (const planStep of planSteps) {
    const expectedRounds = estimateTrainingRounds(planStep.minutes, planStep.mode);
    const planStepRecommendations = recommendations
      .filter(
        (candidate) => candidate.entry.item.mode === planStep.mode && !usedIds.has(candidate.entry.item.id),
      )
      .slice(0, expectedRounds);
    const missingRounds = Math.max(0, expectedRounds - planStepRecommendations.length);

    for (const recommendation of planStepRecommendations) {
      usedIds.add(recommendation.entry.item.id);
    }

    planStepRecommendations.forEach((recommendation, index) => {
      queue.push({
        item: recommendation.entry.item,
        mode: recommendation.entry.item.mode,
        role: recommendation.role,
        reason: recommendation.reason,
        adaptiveReasons: recommendation.entry.reasons,
        score: recommendation.entry.score,
        planStepId: planStep.id,
        planTitle: planStep.title,
        plannedMinutes: planStep.minutes,
        planGoal: planStep.goal,
        planRound: index + 1,
        planRoundCount: expectedRounds,
        planExpectedRoundCount: expectedRounds,
        planMissingRoundCount: missingRounds,
      });
    });
  }

  return queue;
}

export function summarizeDailyPlanQueueCoverage(
  planSteps: DailyPlanStep[],
  queue: TodayTrainingQueueItem[],
): TrainingQueueCoverageIssue[] {
  const actualByStep = new Map<string, number>();
  for (const entry of queue) {
    if (!entry.planStepId) continue;
    actualByStep.set(entry.planStepId, (actualByStep.get(entry.planStepId) ?? 0) + 1);
  }

  return planSteps
    .filter((step) => step.minutes > 0)
    .map((step) => {
      const expectedRounds = estimateTrainingRounds(step.minutes, step.mode);
      const actualRounds = actualByStep.get(step.id) ?? 0;
      return {
        planStepId: step.id,
        planTitle: step.title,
        mode: step.mode,
        expectedRounds,
        actualRounds,
        missingRounds: Math.max(0, expectedRounds - actualRounds),
      };
    })
    .filter((issue) => issue.missingRounds > 0);
}

export function buildTodayQueueReadiness(
  planSteps: DailyPlanStep[],
  queue: TodayTrainingQueueItem[],
): TodayQueueReadiness {
  const activePlanSteps = planSteps.filter((step) => step.minutes > 0);

  if (activePlanSteps.length === 0) {
    return {
      ready: queue.length > 0,
      planned: false,
      expectedRounds: queue.length,
      actualRounds: queue.length,
      missingRounds: 0,
      headline: queue.length > 0 ? "今日目标已完成，可自由加练" : "暂无可训练材料",
      detail:
        queue.length > 0
          ? `当前没有剩余必练分钟，仍可从推荐队列自由加练 ${queue.length} 组。`
          : "导入或恢复材料后，Today 会重新生成推荐队列。",
      modes: summarizeQueueRoundsByMode(queue),
      coverageIssues: [],
    };
  }

  const coverageIssues = summarizeDailyPlanQueueCoverage(activePlanSteps, queue);
  const expectedRounds = activePlanSteps.reduce(
    (sum, step) => sum + estimateTrainingRounds(step.minutes, step.mode),
    0,
  );
  const missingRounds = coverageIssues.reduce((sum, issue) => sum + issue.missingRounds, 0);
  const actualRounds = Math.max(0, expectedRounds - missingRounds);
  const ready = missingRounds === 0;

  return {
    ready,
    planned: true,
    expectedRounds,
    actualRounds,
    missingRounds,
    headline: ready ? "今日队列材料完整" : `今日队列缺 ${missingRounds} 组材料`,
    detail: ready
      ? `今日计划可展开为 ${expectedRounds} 组训练，能按当前训练协议完整执行。`
      : `今日计划需要 ${expectedRounds} 组训练，目前只能覆盖 ${actualRounds} 组；先练已有材料，同时补齐缺口。`,
    modes: activePlanSteps.map((step) => {
      const expected = estimateTrainingRounds(step.minutes, step.mode);
      const issue = coverageIssues.find((candidate) => candidate.planStepId === step.id);
      return {
        mode: step.mode,
        expectedRounds: expected,
        actualRounds: expected - (issue?.missingRounds ?? 0),
        missingRounds: issue?.missingRounds ?? 0,
      };
    }),
    coverageIssues,
  };
}

function summarizeQueueRoundsByMode(queue: TodayTrainingQueueItem[]): TodayQueueReadinessMode[] {
  const modeCounts = new Map<TrainingMode, number>();
  for (const entry of queue) {
    modeCounts.set(entry.mode, (modeCounts.get(entry.mode) ?? 0) + 1);
  }
  return [...modeCounts.entries()].map(([mode, count]) => ({
    mode,
    expectedRounds: count,
    actualRounds: count,
    missingRounds: 0,
  }));
}

function interleaveRecommendations(
  slotSelections: TodayRecommendation[][],
  limit: number,
): TodayRecommendation[] {
  const selected: TodayRecommendation[] = [];
  for (let round = 0; selected.length < limit; round += 1) {
    let added = false;
    for (const slot of slotSelections) {
      const recommendation = slot[round];
      if (!recommendation) continue;
      selected.push(recommendation);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

export function estimateTrainingRounds(minutes: number, mode: TrainingMode): number {
  const minutesPerRound =
    mode === "chinese-real" ? 3 : mode === "english" || mode === "code" ? 2 : 1;
  return Math.max(1, Math.min(6, Math.ceil(minutes / minutesPerRound)));
}

function buildModeSlots(sessions: TrainingSession[], options: FoundationEvaluationOptions): ModeSlot[] {
  const protocol = buildTrainingProtocol(sessions, options);
  const foundationReady = getFoundationReport(sessions, options).status.ready;

  if (!foundationReady) {
    const primary = protocol.primaryMode === "code" ? "code" : "english";
    const secondary = primary === "code" ? "english" : "code";
    return [
      {
        mode: primary,
        role: "primary",
        reason: "今日主线",
        take: 6,
      },
      {
        mode: secondary,
        role: "support",
        reason: secondary === "code" ? "底座补足" : "底座复测",
        take: 5,
      },
      {
        mode: "vim",
        role: "support",
        reason: "工作流维护",
        take: 3,
      },
      {
        mode: "wubi-code",
        role: "maintenance",
        reason: "五笔低量维护",
        take: 2,
      },
    ];
  }

  if (protocol.primaryMode === "chinese-real") {
    return [
      {
        mode: "chinese-real",
        role: "primary",
        reason: "中文主线",
        take: 5,
      },
      {
        mode: "wubi-code",
        role: "support",
        reason: "弱字拆码",
        take: 8,
      },
      {
        mode: "code",
        role: "maintenance",
        reason: "代码手感维护",
        take: 2,
      },
      {
        mode: "english",
        role: "maintenance",
        reason: "英文手感维护",
        take: 2,
      },
    ];
  }

  return [
    {
      mode: "wubi-code",
      role: "primary",
      reason: "五笔主线",
      take: 12,
    },
    {
      mode: "chinese-real",
      role: "support",
      reason: "真实中文迁移",
      take: 3,
    },
    {
      mode: "code",
      role: "maintenance",
      reason: "代码手感维护",
      take: 2,
    },
    {
      mode: "english",
      role: "maintenance",
      reason: "英文手感维护",
      take: 2,
    },
  ];
}
