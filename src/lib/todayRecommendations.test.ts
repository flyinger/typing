import { describe, expect, it } from "vitest";
import type { ExerciseItem, SessionMetrics, TrainingMode, TrainingSession } from "../types";
import type { DailyPlanStep } from "./trainingPlan";
import {
  buildTodayRecommendations,
  buildTodayQueueReadiness,
  buildTodayTrainingQueue,
  summarizeDailyPlanQueueCoverage,
} from "./todayRecommendations";

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

function item(id: string, mode: TrainingMode, targetText: string): ExerciseItem {
  return {
    id,
    mode,
    prompt: "完成下一组训练",
    targetText,
    category: "测试材料",
    tags: ["test"],
    difficulty: 2,
    source: "test",
    contentHash: id,
  };
}

function session(
  index: number,
  mode: TrainingMode,
  itemId = `${mode}-item`,
  targetText = `${mode} target`,
  overrides: Partial<SessionMetrics> = {},
): TrainingSession {
  const startedAt = new Date(Date.UTC(2026, 5, index + 1, 8, 0, 0)).toISOString();
  return {
    id: `${mode}-${index}`,
    deviceId: "device",
    mode,
    itemId,
    targetText,
    inputText: targetText,
    startedAt,
    endedAt: startedAt,
    durationMs: 60000,
    metrics: {
      ...baseMetrics,
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

describe("buildTodayRecommendations", () => {
  it("keeps english and code ahead of wubi maintenance before the foundation is ready", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
        item("vim-next", "vim", "ciw"),
        item("wubi-weak", "wubi-code", "器械"),
      ],
      [
        session(1, "wubi-code", "wubi-weak", "器械", {
          accuracy: 40,
          hintCount: 3,
          hintUsed: true,
          backspacePer100Chars: 90,
          pauseCountOver1500Ms: 4,
          weakTargets: ["器械"],
        }),
      ],
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );

    expect(recommendations.slice(0, 2).map((recommendation) => recommendation.entry.item.mode)).toEqual([
      "english",
      "code",
    ]);
    expect(recommendations.at(-1)).toMatchObject({
      role: "maintenance",
      reason: "五笔低量维护",
      entry: {
        item: {
          id: "wubi-weak",
        },
      },
    });
  });

  it("moves the primary Today recommendation to code after english gates pass", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
      ],
      Array.from({ length: 5 }, (_, index) => session(index, "english")),
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );

    expect(recommendations[0]).toMatchObject({
      role: "primary",
      reason: "今日主线",
      entry: {
        item: {
          id: "code-next",
        },
      },
    });
  });

  it("moves wubi and real chinese ahead of english/code maintenance after foundation readiness", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
        item("wubi-next", "wubi-code", "中"),
        item("chinese-next", "chinese-real", "今天继续整理训练复盘。"),
      ],
      foundationSessions(),
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );

    expect(recommendations.slice(0, 2).map((recommendation) => recommendation.entry.item.mode)).toEqual([
      "wubi-code",
      "chinese-real",
    ]);
    expect(recommendations.slice(2).map((recommendation) => recommendation.role)).toEqual([
      "maintenance",
      "maintenance",
    ]);
  });

  it("builds a runnable queue from the clicked Today recommendation", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
        item("vim-next", "vim", "ciw"),
        item("wubi-next", "wubi-code", "中"),
      ],
      [],
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );
    const queue = buildTodayTrainingQueue(recommendations, 2);

    expect(queue.map((entry) => entry.item.id)).toEqual([
      recommendations[2].entry.item.id,
      recommendations[3].entry.item.id,
      recommendations[0].entry.item.id,
      recommendations[1].entry.item.id,
    ]);
    expect(queue[0]).toMatchObject({
      item: {
        id: "vim-next",
      },
      reason: "工作流维护",
      adaptiveReasons: ["新材料"],
    });
  });

  it("builds the runnable queue in daily plan order when plan steps are provided", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
        item("vim-next", "vim", "ciw"),
        item("wubi-next", "wubi-code", "中"),
      ],
      [],
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );
    const plan: DailyPlanStep[] = [
      {
        id: "english-baseline",
        mode: "english",
        minutes: 8,
        title: "英文速度底座",
        goal: "先把英文技术短句推到 80-100 CPM。",
      },
      {
        id: "code-symbols",
        mode: "code",
        minutes: 7,
        title: "代码符号",
        goal: "括号、引号、缩进、大小写和命名风格。",
      },
      {
        id: "vim-commands",
        mode: "vim",
        minutes: 3,
        title: "Vim/命令",
        goal: "保持 motion 手感。",
      },
      {
        id: "wubi-maintenance",
        mode: "wubi-code",
        minutes: 2,
        title: "五笔低量维护",
        goal: "只保留熟悉度。",
      },
    ];
    const queue = buildTodayTrainingQueue(recommendations, 0, { planSteps: plan });

    expect(queue.map((entry) => entry.mode)).toEqual(["english", "code", "vim", "wubi-code"]);
    expect(queue[0]).toMatchObject({
      planStepId: "english-baseline",
      planTitle: "英文速度底座",
      plannedMinutes: 8,
      planRound: 1,
      planRoundCount: 4,
      planExpectedRoundCount: 4,
      planMissingRoundCount: 3,
      item: {
        id: "english-next",
      },
    });
  });

  it("expands plan steps into multiple unique rounds based on planned minutes", () => {
    const recommendations = buildTodayRecommendations(
      [
        ...Array.from({ length: 4 }, (_, index) =>
          item(`english-${index}`, "english", `english technical phrase ${index}`),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          item(`code-${index}`, "code", `const value${index} = ${index};`),
        ),
        ...Array.from({ length: 3 }, (_, index) =>
          item(`vim-${index}`, "vim", `motion-${index}`),
        ),
        ...Array.from({ length: 2 }, (_, index) =>
          item(`wubi-${index}`, "wubi-code", `中${index}`),
        ),
      ],
      [],
      { now: new Date("2026-06-25T12:00:00.000Z"), limit: 18 },
    );
    const plan: DailyPlanStep[] = [
      {
        id: "english-baseline",
        mode: "english",
        minutes: 8,
        title: "英文速度底座",
        goal: "先把英文技术短句推到 80-100 CPM。",
      },
      {
        id: "code-symbols",
        mode: "code",
        minutes: 7,
        title: "代码符号",
        goal: "括号、引号、缩进、大小写和命名风格。",
      },
      {
        id: "vim-commands",
        mode: "vim",
        minutes: 3,
        title: "Vim/命令",
        goal: "保持 motion 手感。",
      },
      {
        id: "wubi-maintenance",
        mode: "wubi-code",
        minutes: 2,
        title: "五笔低量维护",
        goal: "只保留熟悉度。",
      },
    ];

    const queue = buildTodayTrainingQueue(recommendations, 0, { planSteps: plan });

    expect(queue).toHaveLength(13);
    expect(queue.map((entry) => entry.mode)).toEqual([
      "english",
      "english",
      "english",
      "english",
      "code",
      "code",
      "code",
      "code",
      "vim",
      "vim",
      "vim",
      "wubi-code",
      "wubi-code",
    ]);
    expect(queue[0]).toMatchObject({
      planStepId: "english-baseline",
      planRound: 1,
      planRoundCount: 4,
      planMissingRoundCount: 0,
    });
    expect(queue[3]).toMatchObject({
      planStepId: "english-baseline",
      planRound: 4,
      planRoundCount: 4,
    });
    expect(new Set(queue.map((entry) => entry.item.id)).size).toBe(queue.length);
  });

  it("rotates plan-aware queues to the clicked recommendation mode", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
        item("vim-next", "vim", "ciw"),
        item("wubi-next", "wubi-code", "中"),
      ],
      [],
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );
    const plan: DailyPlanStep[] = [
      {
        id: "english-baseline",
        mode: "english",
        minutes: 8,
        title: "英文速度底座",
        goal: "先把英文技术短句推到 80-100 CPM。",
      },
      {
        id: "code-symbols",
        mode: "code",
        minutes: 7,
        title: "代码符号",
        goal: "括号、引号、缩进、大小写和命名风格。",
      },
      {
        id: "vim-commands",
        mode: "vim",
        minutes: 3,
        title: "Vim/命令",
        goal: "保持 motion 手感。",
      },
      {
        id: "wubi-maintenance",
        mode: "wubi-code",
        minutes: 2,
        title: "五笔低量维护",
        goal: "只保留熟悉度。",
      },
    ];
    const queue = buildTodayTrainingQueue(recommendations, 2, { planSteps: plan });

    expect(queue.map((entry) => entry.mode)).toEqual(["vim", "wubi-code", "english", "code"]);
    expect(queue[0]).toMatchObject({
      planStepId: "vim-commands",
      item: {
        id: "vim-next",
      },
    });
  });

  it("reports daily plan material shortfalls instead of silently shrinking the queue", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
      ],
      [],
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );
    const plan: DailyPlanStep[] = [
      {
        id: "english-baseline",
        mode: "english",
        minutes: 8,
        title: "英文速度底座",
        goal: "先把英文技术短句推到 80-100 CPM。",
      },
      {
        id: "code-symbols",
        mode: "code",
        minutes: 7,
        title: "代码符号",
        goal: "括号、引号、缩进、大小写和命名风格。",
      },
      {
        id: "vim-commands",
        mode: "vim",
        minutes: 3,
        title: "Vim/命令",
        goal: "保持 motion 手感。",
      },
    ];

    const queue = buildTodayTrainingQueue(recommendations, 0, { planSteps: plan });
    const issues = summarizeDailyPlanQueueCoverage(plan, queue);

    expect(queue.map((entry) => entry.planRoundCount)).toEqual([4, 4]);
    expect(issues).toEqual([
      {
        planStepId: "english-baseline",
        planTitle: "英文速度底座",
        mode: "english",
        expectedRounds: 4,
        actualRounds: 1,
        missingRounds: 3,
      },
      {
        planStepId: "code-symbols",
        planTitle: "代码符号",
        mode: "code",
        expectedRounds: 4,
        actualRounds: 1,
        missingRounds: 3,
      },
      {
        planStepId: "vim-commands",
        planTitle: "Vim/命令",
        mode: "vim",
        expectedRounds: 3,
        actualRounds: 0,
        missingRounds: 3,
      },
    ]);
  });

  it("summarizes Today queue readiness for a complete planned queue", () => {
    const recommendations = buildTodayRecommendations(
      [
        ...Array.from({ length: 4 }, (_, index) =>
          item(`english-${index}`, "english", `english technical phrase ${index}`),
        ),
        ...Array.from({ length: 4 }, (_, index) =>
          item(`code-${index}`, "code", `const value${index} = ${index};`),
        ),
      ],
      [],
      { now: new Date("2026-06-25T12:00:00.000Z"), limit: 10 },
    );
    const plan: DailyPlanStep[] = [
      {
        id: "english-baseline",
        mode: "english",
        minutes: 8,
        title: "英文速度底座",
        goal: "先把英文技术短句推到 80-100 CPM。",
      },
      {
        id: "code-symbols",
        mode: "code",
        minutes: 7,
        title: "代码符号",
        goal: "括号、引号、缩进、大小写和命名风格。",
      },
    ];
    const queue = buildTodayTrainingQueue(recommendations, 0, { planSteps: plan });

    const readiness = buildTodayQueueReadiness(plan, queue);

    expect(readiness).toMatchObject({
      ready: true,
      planned: true,
      expectedRounds: 8,
      actualRounds: 8,
      missingRounds: 0,
      headline: "今日队列材料完整",
      coverageIssues: [],
    });
    expect(readiness.modes).toEqual([
      {
        mode: "english",
        expectedRounds: 4,
        actualRounds: 4,
        missingRounds: 0,
      },
      {
        mode: "code",
        expectedRounds: 4,
        actualRounds: 4,
        missingRounds: 0,
      },
    ]);
  });

  it("summarizes Today queue readiness when planned material is missing", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
      ],
      [],
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );
    const plan: DailyPlanStep[] = [
      {
        id: "english-baseline",
        mode: "english",
        minutes: 8,
        title: "英文速度底座",
        goal: "先把英文技术短句推到 80-100 CPM。",
      },
      {
        id: "code-symbols",
        mode: "code",
        minutes: 7,
        title: "代码符号",
        goal: "括号、引号、缩进、大小写和命名风格。",
      },
      {
        id: "vim-commands",
        mode: "vim",
        minutes: 3,
        title: "Vim/命令",
        goal: "保持 motion 手感。",
      },
    ];
    const queue = buildTodayTrainingQueue(recommendations, 0, { planSteps: plan });

    const readiness = buildTodayQueueReadiness(plan, queue);

    expect(readiness).toMatchObject({
      ready: false,
      planned: true,
      expectedRounds: 11,
      actualRounds: 2,
      missingRounds: 9,
      headline: "今日队列缺 9 组材料",
    });
    expect(readiness.modes).toEqual([
      {
        mode: "english",
        expectedRounds: 4,
        actualRounds: 1,
        missingRounds: 3,
      },
      {
        mode: "code",
        expectedRounds: 4,
        actualRounds: 1,
        missingRounds: 3,
      },
      {
        mode: "vim",
        expectedRounds: 3,
        actualRounds: 0,
        missingRounds: 3,
      },
    ]);
  });

  it("uses free-practice readiness wording after the daily plan is complete", () => {
    const recommendations = buildTodayRecommendations(
      [
        item("english-next", "english", "offline first training"),
        item("code-next", "code", "const targetCpm = 80;"),
      ],
      [],
      { now: new Date("2026-06-25T12:00:00.000Z") },
    );
    const queue = buildTodayTrainingQueue(recommendations, 0, { planSteps: [] });

    const readiness = buildTodayQueueReadiness([], queue);

    expect(readiness).toMatchObject({
      ready: true,
      planned: false,
      expectedRounds: 2,
      actualRounds: 2,
      missingRounds: 0,
      headline: "今日目标已完成，可自由加练",
      coverageIssues: [],
    });
  });
});
