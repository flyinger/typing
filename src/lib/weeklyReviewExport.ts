import type { TrainingMode } from "../types";
import type { WeeklyReviewReport } from "./weeklyReview";

const modeLabels: Record<TrainingMode, string> = {
  "wubi-code": "五笔编码",
  "chinese-real": "中文真实输入",
  english: "英文/术语",
  code: "代码",
  vim: "Vim/命令",
};

export function weeklyReviewToMarkdown(report: WeeklyReviewReport): string {
  const lines = [
    `# TypingLab 周复盘 ${report.periodStart} / ${report.periodEnd}`,
    "",
    "## 结论",
    `- 决策：${report.decision.title}`,
    `- 主线：${modeLabels[report.decision.primaryMode]}`,
    `- 说明：${report.decision.body}`,
    "",
    "## 本周概览",
    `- 训练：${report.sessions} 轮，${report.minutes} 分钟，${report.activeDays} 个活跃日`,
    `- 平均速度：${report.average.charsPerMinute} CPM（${formatSigned(report.deltas.charsPerMinute)}）`,
    `- 平均准确率：${report.average.accuracy}%（${formatSigned(report.deltas.accuracy)}）`,
    `- 退格/100字：${report.average.backspacePer100Chars}（${formatSigned(report.deltas.backspacePer100Chars)}）`,
    "",
    "## 主线",
    `- 模式：${modeLabels[report.focus.mode]}`,
    `- 样本：${report.focus.sessions} 轮，${report.focus.minutes} 分钟，${report.focus.activeDays} 个活跃日`,
    `- 速度：${report.focus.average.charsPerMinute} CPM（${formatSigned(report.focus.deltas.charsPerMinute)}）`,
    `- 准确率：${report.focus.average.accuracy}%（${formatSigned(report.focus.deltas.accuracy)}）`,
    `- 退格/100字：${report.focus.average.backspacePer100Chars}（${formatSigned(report.focus.deltas.backspacePer100Chars)}）`,
    "",
    "## 模式投入",
    ...listOrEmpty(
      report.modeSummaries.map(
        (summary) =>
          `- ${modeLabels[summary.mode]}：${summary.sessions} 轮，${summary.minutes} 分钟，${summary.charsPerMinute} CPM，准确率 ${summary.accuracy}%，退格 ${summary.backspacePer100Chars}/100`,
      ),
    ),
    "",
    "## 成果",
    ...listOrEmpty(report.wins.map((item) => `- ${item}`)),
    "",
    "## 风险",
    ...listOrEmpty(report.risks.map((item) => `- ${item}`)),
    "",
    "## 弱项",
    ...listOrEmpty([
      ...report.weakTargets.map((item) => `- 弱字/词：${item.target} × ${item.count}`),
      ...report.weakKeys.map((item) => `- 弱键：${item.key} × ${item.count}`),
    ]),
    "",
    "## 下周计划",
    ...listOrEmpty(
      report.nextWeekPlan.map(
        (item) =>
          `- ${item.title}（${modeLabels[item.mode]}）：每次 ${item.minutesPerSession} 分钟，每周 ${item.sessionsPerWeek} 天，共 ${item.weeklyMinutes} 分钟。目标：${item.goal} 验收：${item.acceptance}`,
      ),
    ),
    "",
    "## 下周动作",
    ...listOrEmpty(report.nextActions.map((item) => `- ${item}`)),
    "",
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}

function listOrEmpty(items: string[]): string[] {
  return items.length > 0 ? items : ["- 暂无"];
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}
