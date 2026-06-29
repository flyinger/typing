import { describe, expect, it } from "vitest";
import {
  buildDailyPlan,
  buildFoundationLiveSampleStatus,
  buildFoundationModeAdvice,
  buildFoundationSprintPlan,
  buildRemainingDailyPlan,
  buildTrainingRoadmap,
  buildTrainingProtocol,
  getFoundationMaintenanceMode,
  getFoundationFocusMode,
  getFoundationReport,
  getFoundationStatus,
  getTrainingStage,
} from "./trainingPlan";
import type { SessionMetrics, TrainingMode, TrainingSession } from "../types";

const baseMetrics: SessionMetrics = {
  charsPerMinute: 85,
  accuracy: 98,
  backspaces: 2,
  backspacePer100Chars: 4,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  correctUnits: 24,
  totalUnits: 24,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
  weakTargets: [],
  errorPositions: [],
};

function makeSession(
  index: number,
  mode: TrainingMode,
  metrics: Partial<SessionMetrics> = {},
): TrainingSession {
  const startedAt = new Date(Date.UTC(2026, 5, index + 1, 0, 0, 0)).toISOString();
  return {
    id: `${mode}-${index}`,
    deviceId: "d1",
    mode,
    itemId: "i1",
    targetText: "foundation typing sample",
    inputText: "foundation typing sample",
    startedAt,
    endedAt: startedAt,
    durationMs: 60000,
    metrics: {
      ...baseMetrics,
      ...metrics,
    },
  };
}

function makeFoundationSessions(metrics: Partial<Record<"english" | "code", Partial<SessionMetrics>>> = {}): TrainingSession[] {
  return [
    ...Array.from({ length: 20 }, (_, index) => makeSession(index, "english", metrics.english)),
    ...Array.from({ length: 20 }, (_, index) => makeSession(index, "code", metrics.code)),
  ];
}

function makeSessionAt(
  id: string,
  mode: TrainingMode,
  startedAt: string,
  metrics: Partial<SessionMetrics> = {},
): TrainingSession {
  return {
    id,
    deviceId: "d1",
    mode,
    itemId: "i1",
    targetText: "foundation typing sample",
    inputText: "foundation typing sample",
    startedAt,
    endedAt: startedAt,
    durationMs: 60000,
    metrics: {
      ...baseMetrics,
      ...metrics,
    },
  };
}

describe("buildDailyPlan", () => {
  it("prioritizes english and code before the speed foundation is ready", () => {
    const plan = buildDailyPlan(30, [], true);
    expect(plan.reduce((sum, step) => sum + step.minutes, 0)).toBe(30);
    expect(plan[0]).toMatchObject({ mode: "english", title: "英文速度底座" });
    expect(plan[1]).toMatchObject({ mode: "code", title: "代码符号" });
  });

  it("moves primary minutes to wubi and real chinese after english/code readiness", () => {
    const sessions = makeFoundationSessions();
    const plan = buildDailyPlan(20, sessions, true);

    expect(plan.reduce((sum, step) => sum + step.minutes, 0)).toBe(20);
    expect(plan.some((step) => step.title === "弱字弱词")).toBe(true);
    expect(plan.some((step) => step.mode === "chinese-real")).toBe(true);
  });

  it("returns to foundation retesting when old 80 CPM samples are stale", () => {
    const sessions = makeFoundationSessions();
    const plan = buildDailyPlan(20, sessions, true, {
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(plan[0]).toMatchObject({
      mode: "english",
      title: "英文速度底座",
    });
    expect(plan.some((step) => step.mode === "chinese-real")).toBe(false);
  });

  it("keeps the weaker foundation mode as maintenance after the wubi main line unlocks", () => {
    const sessions = makeFoundationSessions({
      english: { charsPerMinute: 82 },
      code: { charsPerMinute: 100 },
    });
    const plan = buildDailyPlan(20, sessions, true);
    const maintenance = plan.find((step) => step.id === "english-code-maintenance");

    expect(getFoundationMaintenanceMode(sessions)).toBe("english");
    expect(maintenance).toMatchObject({
      mode: "english",
      title: "英文维护冲 100",
    });
  });

  it("prioritizes code when english gates have passed but code gates are still open", () => {
    const sessions = Array.from({ length: 5 }, (_, index) => makeSession(index, "english"));
    const plan = buildDailyPlan(20, sessions, false);

    expect(getFoundationFocusMode(sessions)).toBe("code");
    expect(plan[0]).toMatchObject({
      mode: "code",
      title: "代码符号",
      minutes: 8,
    });
    expect(plan[1]).toMatchObject({
      mode: "english",
      title: "英文维护复测",
    });
  });

  it("collapses short targets into one focused block", () => {
    const plan = buildDailyPlan(10, [], false);

    expect(plan).toHaveLength(1);
    expect(plan.reduce((sum, step) => sum + step.minutes, 0)).toBe(10);
    expect(plan[0]).toMatchObject({
      mode: "english",
      title: "英文速度补足",
      minutes: 10,
    });
  });

  it("keeps the multi-step plan total exact at the short-plan boundary", () => {
    const plan = buildDailyPlan(15, [], false);

    expect(plan.length).toBeGreaterThan(1);
    expect(plan.reduce((sum, step) => sum + step.minutes, 0)).toBe(15);
  });
});

describe("buildRemainingDailyPlan", () => {
  it("uses the remaining minutes instead of the full daily target", () => {
    const plan = buildRemainingDailyPlan(20, 16.2, [], false);

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      mode: "english",
      minutes: 4,
    });
  });

  it("returns no required steps after the daily target is complete", () => {
    expect(buildRemainingDailyPlan(20, 20, [], false)).toEqual([]);
    expect(buildRemainingDailyPlan(20, 24, [], false)).toEqual([]);
  });

  it("keeps code as the compact focus when english gates have passed", () => {
    const sessions = Array.from({ length: 5 }, (_, index) => makeSession(index, "english"));
    const plan = buildRemainingDailyPlan(20, 14.5, sessions, false);

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      mode: "code",
      title: "代码符号补足",
      minutes: 6,
    });
  });
});

describe("buildFoundationSprintPlan", () => {
  it("turns an empty history into a baseline sprint with concrete unlock estimates", () => {
    const plan = buildFoundationSprintPlan([], 20, false);

    expect(plan).toMatchObject({
      phase: "baseline",
      focusMode: "english",
      focusLabel: "英文速度",
      estimatedSessionsToUnlock: 40,
      estimatedFastTrainingDaysToUnlock: 5,
      estimatedTrainingDaysToUnlock: 20,
    });
    expect(plan.headline).toContain("补齐英文和代码有效基线样本");
    expect(plan.blocks.map((block) => block.role)).toEqual([
      "primary",
      "support",
      "maintenance",
      "maintenance",
    ]);
    expect(plan.targetSummary).toContain("80 CPM 解锁五笔主线");
  });

  it("unlocks the wubi main line at 80 CPM while keeping the weaker foundation mode as maintenance", () => {
    const sessions = makeFoundationSessions({
      english: { charsPerMinute: 82 },
      code: { charsPerMinute: 95 },
    });
    const plan = buildFoundationSprintPlan(sessions, 20, true);

    expect(plan).toMatchObject({
      phase: "wubi-unlocked",
      focusMode: "english",
      estimatedSessionsToUnlock: 0,
      estimatedTrainingDaysToUnlock: 0,
    });
    expect(plan.headline).toContain("80 CPM 已解锁五笔主线");
    expect(plan.blocks[0]).toMatchObject({
      mode: "wubi-code",
      role: "primary",
    });
    expect(plan.blocks.some((block) => block.title === "英文维护冲 100")).toBe(true);
  });

  it("marks the foundation as comfort once english and code are both above 100 CPM", () => {
    const sessions = makeFoundationSessions({
      english: { charsPerMinute: 104 },
      code: { charsPerMinute: 103 },
    });
    const plan = buildFoundationSprintPlan(sessions, 20, false);

    expect(plan).toMatchObject({
      phase: "comfort",
      estimatedSessionsToUnlock: 0,
    });
    expect(plan.strategy).toContain("五笔完成真实中文");
    expect(plan.rules[0]).toContain("英文/代码只做维护");
  });
});

describe("buildFoundationModeAdvice", () => {
  it("keeps the first target on baseline samples before five sessions", () => {
    const advice = buildFoundationModeAdvice("english", 3, baseMetrics);

    expect(advice).toContain("5 轮有效基线样本");
    expect(advice).toContain("当前 3/5");
  });

  it("does not treat five good sessions as enough to switch to wubi", () => {
    const advice = buildFoundationModeAdvice("code", 5, baseMetrics);

    expect(advice).toContain("稳定窗口 5/20");
    expect(advice).toContain("继续累计到 20 轮");
  });

  it("moves a mode to maintenance only after the stable window is full and healthy", () => {
    const advice = buildFoundationModeAdvice("english", 20, baseMetrics);

    expect(advice).toContain("近 20 轮达标");
    expect(advice).toContain("主训练让给短板");
  });
});

describe("getTrainingStage", () => {
  it("starts training at the english/code foundation stage", () => {
    const stage = getTrainingStage([]);
    const protocol = buildTrainingProtocol([]);

    expect(stage.label).toContain("第 1 阶段");
    expect(stage.target).toContain("80 CPM");
    expect(protocol.primaryMode).toBe("english");
  });

  it("moves to production stage when recent metrics are strong", () => {
    const sessions = [
      ...makeFoundationSessions(),
      ...Array.from({ length: 12 }, (_, index) => makeSession(index + 40, "chinese-real")),
      makeSession(52, "english"),
      makeSession(52, "code"),
    ];

    expect(getTrainingStage(sessions).label).toContain("第 4 阶段");
  });

  it("does not use old chinese wins to skip recent migration work", () => {
    const sessions = [
      ...Array.from({ length: 20 }, (_, index) =>
        makeSessionAt(`english-${index}`, "english", `2026-06-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        makeSessionAt(`code-${index}`, "code", `2026-06-${String(index + 1).padStart(2, "0")}T11:00:00.000Z`),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        makeSessionAt(`old-chinese-${index}`, "chinese-real", `2026-05-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        makeSessionAt(`recent-chinese-${index}`, "chinese-real", `2026-06-${String(index + 20).padStart(2, "0")}T10:00:00.000Z`, {
          accuracy: 80,
          charsPerMinute: 20,
          backspacePer100Chars: 18,
        }),
      ),
    ];

    expect(getTrainingStage(sessions).label).toContain("第 3 阶段");
  });
});

describe("buildTrainingRoadmap", () => {
  it("shows the foundation as active and locks wubi before english/code gates pass", () => {
    const roadmap = buildTrainingRoadmap([]);

    expect(roadmap[0]).toMatchObject({
      id: "foundation",
      status: "active",
    });
    expect(roadmap[0].target).toContain("舒适线 100 CPM");
    expect(roadmap[1]).toMatchObject({
      id: "wubi-accuracy",
      status: "locked",
      progress: 0,
    });
  });

  it("unlocks wubi at 80 CPM while keeping foundation maintenance toward 100 CPM", () => {
    const sessions = makeFoundationSessions({
      english: { charsPerMinute: 85 },
      code: { charsPerMinute: 90 },
    });
    const roadmap = buildTrainingRoadmap(sessions);

    expect(roadmap[0]).toMatchObject({
      id: "foundation",
      status: "ready",
    });
    expect(roadmap[0].nextAction).toContain("继续维护到 100 CPM");
    expect(roadmap[1]).toMatchObject({
      id: "wubi-accuracy",
      status: "active",
    });
  });

  it("marks the foundation done only after both english and code reach the 100 CPM comfort line", () => {
    const sessions = makeFoundationSessions({
      english: { charsPerMinute: 102 },
      code: { charsPerMinute: 101 },
    });

    expect(buildTrainingRoadmap(sessions)[0]).toMatchObject({
      id: "foundation",
      status: "done",
      progress: 100,
    });
  });
});

describe("getFoundationStatus", () => {
  it("requires enough english and code samples before declaring readiness", () => {
    expect(getFoundationStatus([makeSession(1, "english")]).ready).toBe(false);
  });

  it("requires both english and code to reach 80 CPM with high accuracy", () => {
    const sessions = [
      ...Array.from({ length: 20 }, (_, index) => makeSession(index, "english")),
      ...Array.from({ length: 20 }, (_, index) =>
        makeSession(index + 20, "code", { charsPerMinute: 78 }),
      ),
    ];

    expect(getFoundationStatus(sessions)).toMatchObject({
      englishCpm: 85,
      codeCpm: 78,
      ready: false,
    });
  });

  it("does not count very short samples toward the stable foundation window", () => {
    const shortSessions = makeFoundationSessions().map((entry) => ({
      ...entry,
      durationMs: 5000,
      metrics: {
        ...entry.metrics,
        charsPerMinute: 240,
        correctUnits: 4,
        totalUnits: 4,
      },
    }));
    const status = getFoundationStatus(shortSessions);
    const report = getFoundationReport(shortSessions);

    expect(status).toMatchObject({
      englishSessions: 20,
      codeSessions: 20,
      englishQualifiedSessions: 0,
      codeQualifiedSessions: 0,
      englishStableSamples: 0,
      codeStableSamples: 0,
      ready: false,
    });
    expect(report.gates.find((gate) => gate.id === "english-stability")).toMatchObject({
      current: "0/20 有效轮",
      passed: false,
    });
    expect(report.gates.find((gate) => gate.id === "english-baseline")).toMatchObject({
      current: "0 有效轮 / 20 总轮",
      passed: false,
    });
    expect(report.recommendation).toContain("单轮至少 12 秒，材料和实际输入都至少 10 个单位");
  });

  it("uses only qualified foundation samples for the 80 CPM averages", () => {
    const sessions = [
      ...makeFoundationSessions({ english: { charsPerMinute: 86 }, code: { charsPerMinute: 88 } }),
      ...Array.from({ length: 5 }, (_, index) => ({
        ...makeSession(index + 50, "english", { charsPerMinute: 300 }),
        durationMs: 2000,
        metrics: {
          ...baseMetrics,
          charsPerMinute: 300,
          correctUnits: 4,
          totalUnits: 4,
        },
      })),
    ];
    const status = getFoundationStatus(sessions, {
      now: new Date("2026-06-20T12:00:00.000Z"),
    });

    expect(status.englishQualifiedSessions).toBe(20);
    expect(status.englishCpm).toBe(86);
    expect(status.ready).toBe(true);
  });

  it("does not count pasted foundation rounds as qualified samples", () => {
    const pastedSessions = makeFoundationSessions().map((entry) => ({
      ...entry,
      metrics: {
        ...entry.metrics,
        pasteEventCount: 1,
      },
    }));
    const status = getFoundationStatus(pastedSessions);
    const report = getFoundationReport(pastedSessions);

    expect(status).toMatchObject({
      englishQualifiedSessions: 0,
      codeQualifiedSessions: 0,
      ready: false,
    });
    expect(report.recommendation).toContain("有效轮次");
  });

  it("does not count rounds with too few typed units as qualified samples", () => {
    const shortInputSessions = makeFoundationSessions().map((entry) => ({
      ...entry,
      inputText: "short",
    }));
    const status = getFoundationStatus(shortInputSessions);
    const report = getFoundationReport(shortInputSessions);

    expect(status).toMatchObject({
      englishQualifiedSessions: 0,
      codeQualifiedSessions: 0,
      ready: false,
    });
    expect(report.recommendation).toContain("有效轮次");
  });

  it("does not count hinted foundation rounds as qualified samples", () => {
    const hintedSessions = makeFoundationSessions().map((entry) => ({
      ...entry,
      metrics: {
        ...entry.metrics,
        hintCount: 1,
        hintUsed: true,
      },
    }));
    const status = getFoundationStatus(hintedSessions);
    const report = getFoundationReport(hintedSessions);

    expect(status).toMatchObject({
      englishQualifiedSessions: 0,
      codeQualifiedSessions: 0,
      ready: false,
    });
    expect(report.recommendation).toContain("有效轮次");
  });

  it("uses the most recent foundation samples rather than import order", () => {
    const sessions = [
      ...Array.from({ length: 20 }, (_, index) =>
        makeSessionAt(`old-english-${index}`, "english", `2026-05-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        makeSessionAt(`old-code-${index}`, "code", `2026-05-${String(index + 1).padStart(2, "0")}T11:00:00.000Z`),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        makeSessionAt(`recent-english-${index}`, "english", `2026-06-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`, {
          charsPerMinute: 50,
        }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        makeSessionAt(`recent-code-${index}`, "code", `2026-06-${String(index + 1).padStart(2, "0")}T11:00:00.000Z`, {
          charsPerMinute: 50,
        }),
      ),
    ];
    const status = getFoundationStatus(sessions);

    expect(status.ready).toBe(false);
    expect(status.englishCpm).toBeLessThan(80);
    expect(status.codeCpm).toBeLessThan(80);
  });

  it("does not unlock wubi after only the 5-session baseline samples", () => {
    const sessions = [
      ...Array.from({ length: 5 }, (_, index) => makeSession(index, "english")),
      ...Array.from({ length: 5 }, (_, index) => makeSession(index + 5, "code")),
    ];
    const status = getFoundationStatus(sessions);

    expect(status).toMatchObject({
      englishStableSamples: 5,
      codeStableSamples: 5,
      ready: false,
    });
  });

  it("expires foundation readiness when recent retests are older than the freshness window", () => {
    const sessions = makeFoundationSessions();
    const status = getFoundationStatus(sessions, {
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(status).toMatchObject({
      englishFresh: false,
      codeFresh: false,
      ready: false,
    });
    expect(status.englishDaysSincePractice).toBeGreaterThan(14);
    expect(status.codeDaysSincePractice).toBeGreaterThan(14);
  });
});

describe("buildFoundationLiveSampleStatus", () => {
  it("does not apply the foundation sample gate outside english and code", () => {
    const status = buildFoundationLiveSampleStatus({
      mode: "wubi-code",
      elapsedMs: 30000,
      targetText: "中",
      inputText: "k",
      hintCount: 0,
      pasteEventCount: 0,
    });

    expect(status).toMatchObject({
      applies: false,
      state: "not-foundation",
      label: "非底座模式",
      checks: [],
    });
  });

  it("shows what is still missing before an english/code sample can count", () => {
    const status = buildFoundationLiveSampleStatus({
      mode: "english",
      elapsedMs: 7000,
      targetText: "foundation typing sample",
      inputText: "short",
      hintCount: 0,
      pasteEventCount: 0,
    });

    expect(status).toMatchObject({
      applies: true,
      state: "waiting",
      label: "还不能计入底座",
    });
    expect(status.detail).toContain("再保持 5 秒");
    expect(status.detail).toContain("再输入 5 个单位");
    expect(status.checks.find((check) => check.id === "duration")).toMatchObject({
      passed: false,
      blocking: false,
    });
    expect(status.checks.find((check) => check.id === "typed")).toMatchObject({
      current: "5 单位",
      passed: false,
    });
  });

  it("blocks foundation credit when hints or paste-like input were used", () => {
    const status = buildFoundationLiveSampleStatus({
      mode: "code",
      elapsedMs: 20000,
      targetText: "const targetCpm = 80;",
      inputText: "const targetCpm = 80;",
      hintCount: 1,
      pasteEventCount: 1,
    });

    expect(status).toMatchObject({
      applies: true,
      state: "blocked",
      label: "本轮不计入底座",
    });
    expect(status.detail).toContain("提示");
    expect(status.detail).toContain("粘贴/突增");
    expect(status.checks.find((check) => check.id === "hint")).toMatchObject({
      passed: false,
      blocking: true,
    });
  });

  it("marks the live foundation sample as ready when all effective-sample checks pass", () => {
    const status = buildFoundationLiveSampleStatus({
      mode: "code",
      elapsedMs: 12000,
      targetText: "const targetCpm = 80;",
      inputText: "const targetCpm = 80;",
      hintCount: 0,
      pasteEventCount: 0,
    });

    expect(status).toMatchObject({
      applies: true,
      state: "ready",
      label: "可计入底座",
    });
    expect(status.checks.every((check) => check.passed)).toBe(true);
  });
});

describe("getFoundationReport", () => {
  it("does not pass metric gates before a mode has any samples", () => {
    const report = getFoundationReport([]);

    expect(report.completedGates).toBe(0);
    expect(report.gates.every((gate) => !gate.passed)).toBe(true);
    expect(report.recommendation).toContain("先补足英文基线样本");
  });

  it("explains the next open foundation gate", () => {
    const report = getFoundationReport([makeSession(1, "english")]);

    expect(report.totalGates).toBe(12);
    expect(report.completedGates).toBeLessThan(12);
    expect(report.gates[0]).toMatchObject({
      id: "english-baseline",
      passed: false,
    });
    expect(report.recommendation).toContain("先补足英文基线样本");
  });

  it("marks the foundation ready when all gates pass", () => {
    const sessions = makeFoundationSessions();
    const report = getFoundationReport(sessions);

    expect(report.completedGates).toBe(report.totalGates);
    expect(report.status.ready).toBe(true);
    expect(report.recommendation).toContain("切到五笔和真实中文");
  });

  it("reports stale retest gates before keeping wubi unlocked", () => {
    const report = getFoundationReport(makeFoundationSessions(), {
      now: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(report.status.ready).toBe(false);
    expect(report.gates.find((gate) => gate.id === "english-freshness")).toMatchObject({
      passed: false,
      current: "30 天前",
    });
    expect(report.recommendation).toContain("复测有效期已过期");
  });
});

describe("buildTrainingProtocol", () => {
  it("keeps english/code as the primary protocol before the foundation is ready", () => {
    const protocol = buildTrainingProtocol([]);

    expect(protocol.title).toContain("英文/代码速度底座");
    expect(protocol.primaryMode).toBe("english");
    expect(protocol.exitCriteria).toContain("英文和代码近 20 轮平均速度都 >= 80 CPM");
  });

  it("moves the primary protocol to code when english gates have passed but code samples are missing", () => {
    const sessions = Array.from({ length: 5 }, (_, index) => makeSession(index, "english"));
    const protocol = buildTrainingProtocol(sessions);

    expect(protocol.primaryMode).toBe("code");
    expect(protocol.reviewChecklist[0]).toContain("代码基线样本");
  });

  it("moves the primary protocol to wubi after the english/code foundation is ready", () => {
    const sessions = makeFoundationSessions();
    const protocol = buildTrainingProtocol(sessions);

    expect(protocol.title).toContain("五笔编码准确");
    expect(protocol.primaryMode).toBe("wubi-code");
  });

  it("moves to the production protocol after chinese metrics are stable", () => {
    const sessions = [
      ...makeFoundationSessions(),
      ...Array.from({ length: 8 }, (_, index) => makeSession(index + 40, "chinese-real")),
      makeSession(48, "english"),
      makeSession(48, "code"),
    ];
    const protocol = buildTrainingProtocol(sessions);

    expect(protocol.title).toContain("生产切换");
    expect(protocol.primaryMode).toBe("chinese-real");
  });
});
