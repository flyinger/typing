import { describe, expect, it } from "vitest";
import type { SessionMetrics, TrainingMode, TrainingSession } from "../types";
import { buildWeeklyReviewReport } from "./weeklyReview";

const baseMetrics: SessionMetrics = {
  charsPerMinute: 82,
  accuracy: 97,
  backspaces: 2,
  backspacePer100Chars: 5,
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

function makeSession(
  id: string,
  mode: TrainingMode,
  startedAt: string,
  metrics: Partial<SessionMetrics> = {},
): TrainingSession {
  return {
    id,
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

function makeFoundationSessions(): TrainingSession[] {
  return [
    ...Array.from({ length: 20 }, (_, index) =>
      makeSession(
        `english-${index}`,
        "english",
        new Date(Date.UTC(2026, 5, index + 1, 10, 0, 0)).toISOString(),
      ),
    ),
    ...Array.from({ length: 20 }, (_, index) =>
      makeSession(
        `code-${index}`,
        "code",
        new Date(Date.UTC(2026, 5, index + 1, 11, 0, 0)).toISOString(),
      ),
    ),
  ];
}

describe("buildWeeklyReviewReport", () => {
  it("summarizes the current week and compares it with the previous week", () => {
    const report = buildWeeklyReviewReport(
      [
        makeSession("current-1", "english", "2026-06-25T10:00:00.000Z", { charsPerMinute: 90 }),
        makeSession("current-2", "code", "2026-06-24T10:00:00.000Z", { charsPerMinute: 80 }),
        makeSession("previous-1", "english", "2026-06-18T10:00:00.000Z", { charsPerMinute: 70 }),
      ],
      new Date("2026-06-26T00:00:00.000Z"),
    );

    expect(report.periodStart).toBe("2026-06-20");
    expect(report.periodEnd).toBe("2026-06-26");
    expect(report.sessions).toBe(2);
    expect(report.activeDays).toBe(2);
    expect(report.average.charsPerMinute).toBe(85);
    expect(report.deltas.charsPerMinute).toBe(15);
    expect(report.focus).toMatchObject({
      mode: "english",
      sessions: 1,
      minutes: 1,
      activeDays: 1,
      average: { charsPerMinute: 90 },
      previousAverage: { charsPerMinute: 70 },
      deltas: { charsPerMinute: 20 },
    });
    expect(report.modeSummaries.map((summary) => summary.mode)).toEqual(["english", "code"]);
  });

  it("keeps weekly risks tied to the current primary mode instead of mixed averages", () => {
    const report = buildWeeklyReviewReport(
      [
        makeSession("current-english", "english", "2026-06-25T10:00:00.000Z", {
          charsPerMinute: 92,
          accuracy: 98,
          backspacePer100Chars: 4,
        }),
        makeSession("current-code", "code", "2026-06-24T10:00:00.000Z", {
          charsPerMinute: 40,
          accuracy: 82,
          backspacePer100Chars: 24,
        }),
      ],
      new Date("2026-06-26T00:00:00.000Z"),
    );

    expect(report.average).toMatchObject({
      charsPerMinute: 66,
      accuracy: 90,
      backspacePer100Chars: 14,
    });
    expect(report.focus).toMatchObject({
      mode: "english",
      sessions: 1,
      average: {
        charsPerMinute: 92,
        accuracy: 98,
        backspacePer100Chars: 4,
      },
    });
    expect(report.wins[0]).toContain("主线 英文 1 轮");
    expect(report.risks).toContain("本周 英文 主线只有 1 轮，样本偏少。");
    expect(report.risks).not.toContain("主线 英文 准确率 90%，下周先稳准确率再提速。");
  });

  it("keeps the weekly decision on english/code while foundation gates are open", () => {
    const report = buildWeeklyReviewReport(
      [makeSession("current-1", "english", "2026-06-25T10:00:00.000Z")],
      new Date("2026-06-26T00:00:00.000Z"),
    );

    expect(report.decision.title).toBe("继续英文/代码底座");
    expect(report.decision.primaryMode).toBe("english");
    expect(report.decision.body).toContain("本周主线 英文");
    expect(report.nextActions).toContain("下周继续优先完成英文/代码底座门槛。");
    expect(report.nextWeekPlan.slice(0, 2).map((item) => item.mode)).toEqual(["english", "code"]);
    expect(report.nextWeekPlan[0]).toMatchObject({
      title: "英文速度底座",
      minutesPerSession: 8,
      sessionsPerWeek: 5,
      weeklyMinutes: 40,
    });
    expect(report.nextWeekPlan[0].acceptance).toContain(">=80 CPM");
  });

  it("moves the weekly decision to wubi after the foundation is ready", () => {
    const sessions = makeFoundationSessions();
    const report = buildWeeklyReviewReport(sessions, new Date("2026-06-26T00:00:00.000Z"));

    expect(report.decision.title).toBe("可以推进五笔主线");
    expect(report.decision.primaryMode).toBe("wubi-code");
    expect(report.focus.mode).toBe("wubi-code");
    expect(report.risks).toContain("本周没有 五笔 主线样本，周复盘不能用混合均值判断升级。");
    expect(report.nextActions).toContain("下周主线改为五笔编码、弱字弱词和真实中文。");
    expect(report.nextWeekPlan.slice(0, 3).map((item) => item.mode)).toEqual([
      "wubi-code",
      "wubi-code",
      "chinese-real",
    ]);
    expect(report.nextWeekPlan.some((item) => item.title.includes("维护冲 100"))).toBe(true);
  });

  it("turns weak targets and wrong keys into next actions", () => {
    const report = buildWeeklyReviewReport(
      [
        makeSession("current-1", "english", "2026-06-25T10:00:00.000Z", {
          weakTargets: ["x"],
          wrongKeys: ["j"],
          accuracy: 80,
          backspacePer100Chars: 18,
        }),
      ],
      new Date("2026-06-26T00:00:00.000Z"),
    );

    expect(report.risks).toEqual(expect.arrayContaining([
      "平均准确率 80%，下周先稳准确率再提速。",
      "退格 18/100 字偏高，说明修正成本过大。",
      "最突出弱项是「x」，出现 1 次。",
    ]));
    expect(report.nextActions).toEqual(expect.arrayContaining([
      "把「x」加入下周弱项复练。",
      "安排 j 键相关材料，降低错键和退格。",
    ]));
    expect(report.nextWeekPlan.some((item) => item.acceptance.includes("j 键"))).toBe(true);
  });

  it("groups sessions by local calendar day near midnight", () => {
    const report = buildWeeklyReviewReport(
      [
        makeSession("current-local", "english", new Date(2026, 5, 26, 0, 20).toISOString()),
        makeSession("previous-local", "english", new Date(2026, 5, 25, 23, 40).toISOString()),
      ],
      new Date(2026, 5, 26, 12, 0),
      1,
    );

    expect(report.periodStart).toBe("2026-06-26");
    expect(report.periodEnd).toBe("2026-06-26");
    expect(report.sessions).toBe(1);
    expect(report.activeDays).toBe(1);
    expect(report.deltas.minutes).toBe(0);
  });
});
