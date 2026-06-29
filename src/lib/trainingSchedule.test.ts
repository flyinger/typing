import { describe, expect, it } from "vitest";
import type { SessionMetrics, TrainingMode, TrainingSession } from "../types";
import { buildTrainingSchedule } from "./trainingSchedule";

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

function session(index: number, mode: TrainingMode, metrics: Partial<SessionMetrics> = {}): TrainingSession {
  const startedAt = new Date(Date.UTC(2026, 5, index + 1, 8, 0, 0)).toISOString();
  return {
    id: `${mode}-${index}`,
    deviceId: "device-1",
    mode,
    itemId: "item-1",
    targetText: "target hit",
    inputText: "target hit",
    startedAt,
    endedAt: startedAt,
    durationMs: 60000,
    metrics: {
      ...baseMetrics,
      ...metrics,
    },
  };
}

function foundationSessions(metrics: Partial<Record<"english" | "code", Partial<SessionMetrics>>> = {}): TrainingSession[] {
  return [
    ...Array.from({ length: 20 }, (_, index) => session(index, "english", metrics.english)),
    ...Array.from({ length: 20 }, (_, index) => session(index, "code", metrics.code)),
  ];
}

describe("buildTrainingSchedule", () => {
  it("starts with foundation days and a concrete switch estimate when there is no history", () => {
    const schedule = buildTrainingSchedule([], 20, 20, false);

    expect(schedule).toMatchObject({
      currentPhase: "baseline",
      estimatedFastTrainingDaysToUnlock: 5,
      estimatedTrainingDaysToUnlock: 20,
      expectedSwitchDay: undefined,
      horizonDays: 20,
    });
    expect(schedule.headline).toContain("最快 5 个训练日");
    expect(schedule.headline).toContain("保守约 20 个训练日");
    expect(schedule.days).toHaveLength(20);
    expect(schedule.days[0]).toMatchObject({
      kind: "foundation",
      title: "底座推进日",
      minutes: 20,
    });
    expect(schedule.days[4]).toMatchObject({
      kind: "foundation",
      checkpoint: true,
      syncAction: "写入同步目录或导出同步包。",
    });
    expect(schedule.days.every((day) => day.kind === "foundation")).toBe(true);
    expect(schedule.reviewCadence.join(" ")).toContain("各满 20 个有效轮次、最近 14 天内复测且 80 CPM 达标后切五笔主线");
  });

  it("surfaces the transition day when the horizon covers the foundation window", () => {
    const schedule = buildTrainingSchedule([], 20, 25, false);

    expect(schedule).toMatchObject({
      currentPhase: "baseline",
      estimatedFastTrainingDaysToUnlock: 5,
      estimatedTrainingDaysToUnlock: 20,
      expectedSwitchDay: 21,
      horizonDays: 25,
    });
    expect(schedule.days[19]).toMatchObject({
      day: 20,
      kind: "foundation",
    });
    expect(schedule.days[20]).toMatchObject({
      day: 21,
      kind: "transition",
      title: "80 CPM 解锁复测",
      syncAction: "写入同步目录或导出同步包。",
    });
  });

  it("switches directly to wubi main days after the foundation is ready", () => {
    const sessions = foundationSessions({
      english: { charsPerMinute: 86 },
      code: { charsPerMinute: 92 },
    });
    const schedule = buildTrainingSchedule(sessions, 20, 10, true);

    expect(schedule).toMatchObject({
      currentPhase: "wubi-unlocked",
      expectedSwitchDay: undefined,
    });
    expect(schedule.days[0]).toMatchObject({
      kind: "wubi-main",
      phase: "五笔主线",
    });
    expect(schedule.days[0].blocks[0]).toMatchObject({
      mode: "wubi-code",
      title: "字根/简码",
      role: "primary",
    });
    expect(schedule.days[0].blocks.some((block) => block.title === "英文维护冲 100")).toBe(true);
  });

  it("uses production maintenance days after english and code reach the comfort line", () => {
    const sessions = foundationSessions({
      english: { charsPerMinute: 104 },
      code: { charsPerMinute: 105 },
    });
    const schedule = buildTrainingSchedule(sessions, 30, 5, true);

    expect(schedule.currentPhase).toBe("comfort");
    expect(schedule.headline).toContain("未来 5 个训练日");
    expect(schedule.days.every((day) => day.kind === "comfort")).toBe(true);
    expect(schedule.days[0].summary).toContain("英文/代码已进入舒适区");
    expect(schedule.days[4]).toMatchObject({
      checkpoint: true,
      syncAction: "写入同步目录或导出同步包。",
    });
  });
});
