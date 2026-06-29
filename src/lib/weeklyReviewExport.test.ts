import { describe, expect, it } from "vitest";
import type { SessionMetrics, TrainingSession } from "../types";
import { buildWeeklyReviewReport } from "./weeklyReview";
import { weeklyReviewToMarkdown } from "./weeklyReviewExport";

const metrics: SessionMetrics = {
  charsPerMinute: 88,
  accuracy: 97,
  backspaces: 2,
  backspacePer100Chars: 6,
  pauseCountOver1500Ms: 1,
  maxPauseMs: 1800,
  correctUnits: 20,
  totalUnits: 20,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: ["j"],
  weakTargets: ["visual servo"],
  errorPositions: [4],
};

function session(id: string): TrainingSession {
  return {
    id,
    deviceId: "device-1",
    mode: "english",
    itemId: "item-1",
    targetText: "visual servo control loop",
    inputText: "visual servo control loop",
    startedAt: "2026-06-25T10:00:00.000Z",
    endedAt: "2026-06-25T10:01:00.000Z",
    durationMs: 60000,
    metrics,
  };
}

describe("weeklyReviewToMarkdown", () => {
  it("exports a stable markdown weekly review", () => {
    const report = buildWeeklyReviewReport([session("s1")], new Date("2026-06-26T12:00:00.000Z"));
    const markdown = weeklyReviewToMarkdown(report);

    expect(markdown).toContain("# TypingLab 周复盘 2026-06-20 / 2026-06-26");
    expect(markdown).toContain("## 结论");
    expect(markdown).toContain("- 决策：继续英文/代码底座");
    expect(markdown).toContain("- 主线：英文/术语");
    expect(markdown).toContain("## 弱项");
    expect(markdown).toContain("- 弱字/词：visual servo × 1");
    expect(markdown).toContain("- 弱键：j × 1");
    expect(markdown).toContain("## 下周计划");
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
