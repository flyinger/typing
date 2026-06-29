import type { TrainingMode, TrainingSession } from "../types";
import { addLocalDays, localDateKey, startOfLocalDate } from "./date";
import { averageMetrics, rankWeakKeys, rankWeakTargets } from "./metrics";
import { buildDailyPlan, buildTrainingProtocol, getFoundationReport, type DailyPlanStep } from "./trainingPlan";

export interface WeeklyModeSummary {
  mode: TrainingMode;
  sessions: number;
  minutes: number;
  charsPerMinute: number;
  accuracy: number;
  backspacePer100Chars: number;
}

export interface WeeklyFocusSummary {
  mode: TrainingMode;
  sessions: number;
  minutes: number;
  activeDays: number;
  average: {
    charsPerMinute: number;
    accuracy: number;
    backspacePer100Chars: number;
  };
  previousAverage: {
    charsPerMinute: number;
    accuracy: number;
    backspacePer100Chars: number;
  };
  deltas: {
    charsPerMinute: number;
    accuracy: number;
    backspacePer100Chars: number;
    minutes: number;
  };
}

export interface WeeklyTrainingPlanItem {
  id: string;
  mode: TrainingMode;
  title: string;
  minutesPerSession: number;
  sessionsPerWeek: number;
  weeklyMinutes: number;
  goal: string;
  acceptance: string;
}

export interface WeeklyReviewReport {
  periodStart: string;
  periodEnd: string;
  sessions: number;
  minutes: number;
  activeDays: number;
  average: {
    charsPerMinute: number;
    accuracy: number;
    backspacePer100Chars: number;
  };
  previousAverage: {
    charsPerMinute: number;
    accuracy: number;
    backspacePer100Chars: number;
  };
  deltas: {
    charsPerMinute: number;
    accuracy: number;
    backspacePer100Chars: number;
    minutes: number;
  };
  focus: WeeklyFocusSummary;
  modeSummaries: WeeklyModeSummary[];
  weakTargets: Array<{ target: string; count: number }>;
  weakKeys: Array<{ key: string; count: number }>;
  decision: {
    title: string;
    body: string;
    primaryMode: TrainingMode;
  };
  wins: string[];
  risks: string[];
  nextActions: string[];
  nextWeekPlan: WeeklyTrainingPlanItem[];
}

const modes: TrainingMode[] = ["english", "code", "vim", "wubi-code", "chinese-real"];
const plannedTrainingDays = 5;
const nextWeekDailyMinutes = 20;

export function buildWeeklyReviewReport(
  sessions: TrainingSession[],
  now = new Date(),
  days = 7,
): WeeklyReviewReport {
  const normalizedDays = Math.max(1, Math.floor(days));
  const periodEnd = localDateKey(now);
  const periodStartDate = addLocalDays(startOfLocalDate(now), -(normalizedDays - 1));
  const periodStart = localDateKey(periodStartDate);
  const previousStart = localDateKey(addLocalDays(periodStartDate, -normalizedDays));
  const previousEnd = localDateKey(addLocalDays(periodStartDate, -1));
  const currentSessions = filterByDateRange(sessions, periodStart, periodEnd);
  const previousSessions = filterByDateRange(sessions, previousStart, previousEnd);
  const average = averageMetrics(currentSessions);
  const previousAverage = averageMetrics(previousSessions);
  const minutes = sumMinutes(currentSessions);
  const previousMinutes = sumMinutes(previousSessions);
  const modeSummaries = modes
    .map((mode) => summarizeMode(mode, currentSessions))
    .filter((summary) => summary.sessions > 0);
  const foundationReport = getFoundationReport(sessions, { now });
  const protocol = buildTrainingProtocol(sessions, { now });
  const focus = buildFocusSummary(protocol.primaryMode, currentSessions, previousSessions);
  const weakTargets = rankWeakTargets(currentSessions, 8);
  const weakKeys = rankWeakKeys(currentSessions, 8);
  const nextWeekPlan = buildNextWeekPlan({
    sessions,
    weakTargets,
    weakKeys,
    now,
  });

  return {
    periodStart,
    periodEnd,
    sessions: currentSessions.length,
    minutes,
    activeDays: countActiveDays(currentSessions),
    average,
    previousAverage,
    deltas: {
      charsPerMinute: delta(average.charsPerMinute, previousAverage.charsPerMinute),
      accuracy: delta(average.accuracy, previousAverage.accuracy),
      backspacePer100Chars: delta(average.backspacePer100Chars, previousAverage.backspacePer100Chars),
      minutes: delta(minutes, previousMinutes),
    },
    focus,
    modeSummaries,
    weakTargets,
    weakKeys,
    decision: {
      title: foundationReport.status.ready ? "可以推进五笔主线" : "继续英文/代码底座",
      body: foundationReport.status.ready
        ? buildDecisionBodyForReadyFoundation(focus)
        : `${foundationReport.recommendation} 本周主线 ${modeLabel(focus.mode)}：${focus.sessions} 轮、${focus.average.charsPerMinute} CPM、准确率 ${focus.average.accuracy}%。`,
      primaryMode: protocol.primaryMode,
    },
    wins: buildWins({
      currentSessions,
      activeDays: countActiveDays(currentSessions),
      average,
      focus,
      foundationReady: foundationReport.status.ready,
    }),
    risks: buildRisks({ currentSessions, activeDays: countActiveDays(currentSessions), average, focus, weakTargets, weakKeys }),
    nextActions: buildNextActions({ protocol, weakTargets, weakKeys, foundationReady: foundationReport.status.ready }),
    nextWeekPlan,
  };
}

function summarizeMode(mode: TrainingMode, sessions: TrainingSession[]): WeeklyModeSummary {
  const modeSessions = sessions.filter((session) => session.mode === mode);
  const average = averageMetrics(modeSessions);
  return {
    mode,
    sessions: modeSessions.length,
    minutes: sumMinutes(modeSessions),
    charsPerMinute: average.charsPerMinute,
    accuracy: average.accuracy,
    backspacePer100Chars: average.backspacePer100Chars,
  };
}

function buildFocusSummary(
  mode: TrainingMode,
  currentSessions: TrainingSession[],
  previousSessions: TrainingSession[],
): WeeklyFocusSummary {
  const currentModeSessions = currentSessions.filter((session) => session.mode === mode);
  const previousModeSessions = previousSessions.filter((session) => session.mode === mode);
  const average = averageMetrics(currentModeSessions);
  const previousAverage = averageMetrics(previousModeSessions);
  const minutes = sumMinutes(currentModeSessions);
  const previousMinutes = sumMinutes(previousModeSessions);

  return {
    mode,
    sessions: currentModeSessions.length,
    minutes,
    activeDays: countActiveDays(currentModeSessions),
    average,
    previousAverage,
    deltas: {
      charsPerMinute: delta(average.charsPerMinute, previousAverage.charsPerMinute),
      accuracy: delta(average.accuracy, previousAverage.accuracy),
      backspacePer100Chars: delta(average.backspacePer100Chars, previousAverage.backspacePer100Chars),
      minutes: delta(minutes, previousMinutes),
    },
  };
}

function buildDecisionBodyForReadyFoundation(focus: WeeklyFocusSummary): string {
  const base = "英文/代码底座已达标，下周主训练时间放到五笔编码和真实中文，保留较弱英文或代码的 100 CPM 维护块。";
  if (focus.sessions === 0) {
    return `${base} 本周主线 ${modeLabel(focus.mode)} 还没有样本，下周先补齐主线样本再判断中文迁移速度。`;
  }
  return `${base} 本周主线 ${modeLabel(focus.mode)}：${focus.sessions} 轮、${focus.average.charsPerMinute} CPM、准确率 ${focus.average.accuracy}%。`;
}

function buildWins({
  currentSessions,
  activeDays,
  average,
  focus,
  foundationReady,
}: {
  currentSessions: TrainingSession[];
  activeDays: number;
  average: WeeklyReviewReport["average"];
  focus: WeeklyFocusSummary;
  foundationReady: boolean;
}): string[] {
  if (currentSessions.length === 0) {
    return ["本周还没有训练数据，先完成 3 到 5 轮基线训练。"];
  }

  const wins: string[] = [];
  if (focus.sessions > 0 && focus.average.accuracy >= 96) {
    wins.push(`主线 ${modeLabel(focus.mode)} ${focus.sessions} 轮，准确率 ${focus.average.accuracy}%，可以作为下周判断依据。`);
  }
  if (activeDays >= 5) wins.push(`本周训练 ${activeDays} 天，节奏已经足够稳定。`);
  if (average.accuracy >= 96) wins.push(`本周平均准确率 ${average.accuracy}%，可以在稳定基础上提速。`);
  if (average.backspacePer100Chars <= 10) wins.push(`退格控制在 ${average.backspacePer100Chars}/100 字，输入修正成本较低。`);
  if (foundationReady) wins.push("英文/代码底座已达标，训练主线可以切到五笔。");
  if (wins.length === 0) wins.push("已经产生可复盘数据，下周先把节奏和准确率稳住。");
  return wins;
}

function buildRisks({
  currentSessions,
  activeDays,
  average,
  focus,
  weakTargets,
  weakKeys,
}: {
  currentSessions: TrainingSession[];
  activeDays: number;
  average: WeeklyReviewReport["average"];
  focus: WeeklyFocusSummary;
  weakTargets: Array<{ target: string; count: number }>;
  weakKeys: Array<{ key: string; count: number }>;
}): string[] {
  if (currentSessions.length === 0) {
    return ["没有本周数据，无法判断速度、准确率和弱项趋势。"];
  }

  const risks: string[] = [];
  if (focus.sessions === 0) {
    risks.push(`本周没有 ${modeLabel(focus.mode)} 主线样本，周复盘不能用混合均值判断升级。`);
  } else if (focus.sessions < 3) {
    risks.push(`本周 ${modeLabel(focus.mode)} 主线只有 ${focus.sessions} 轮，样本偏少。`);
  }
  if (focus.sessions > 0 && focus.average.accuracy < 94) {
    risks.push(`主线 ${modeLabel(focus.mode)} 准确率 ${focus.average.accuracy}%，下周先稳准确率再提速。`);
  }
  if (focus.sessions > 0 && focus.average.backspacePer100Chars > 15) {
    risks.push(`主线 ${modeLabel(focus.mode)} 退格 ${focus.average.backspacePer100Chars}/100 字偏高，先做保护性重练。`);
  }
  if (activeDays < 3) risks.push(`本周只训练 ${activeDays} 天，样本不足，趋势判断不稳。`);
  if (average.accuracy < 94) risks.push(`平均准确率 ${average.accuracy}%，下周先稳准确率再提速。`);
  if (average.backspacePer100Chars > 15) risks.push(`退格 ${average.backspacePer100Chars}/100 字偏高，说明修正成本过大。`);
  if (weakTargets[0]) risks.push(`最突出弱项是「${weakTargets[0].target}」，出现 ${weakTargets[0].count} 次。`);
  if (!weakTargets[0] && weakKeys[0]) risks.push(`最突出弱键是 ${weakKeys[0].key}，出现 ${weakKeys[0].count} 次。`);
  if (risks.length === 0) risks.push("本周没有明显风险，下周可以增加材料长度或难度。");
  return risks;
}

function buildNextActions({
  protocol,
  weakTargets,
  weakKeys,
  foundationReady,
}: {
  protocol: ReturnType<typeof buildTrainingProtocol>;
  weakTargets: Array<{ target: string; count: number }>;
  weakKeys: Array<{ key: string; count: number }>;
  foundationReady: boolean;
}): string[] {
  const actions = [
    protocol.reviewChecklist[0],
    foundationReady ? "下周主线改为五笔编码、弱字弱词和真实中文。" : "下周继续优先完成英文/代码底座门槛。",
  ];
  if (weakTargets[0]) actions.push(`把「${weakTargets[0].target}」加入下周弱项复练。`);
  if (weakKeys[0]) actions.push(`安排 ${weakKeys[0].key} 键相关材料，降低错键和退格。`);
  actions.push("周末导出同步包或同步目录清单，确认另一台电脑可合并。");
  return Array.from(new Set(actions)).slice(0, 5);
}

function buildNextWeekPlan({
  sessions,
  weakTargets,
  weakKeys,
  now,
}: {
  sessions: TrainingSession[];
  weakTargets: Array<{ target: string; count: number }>;
  weakKeys: Array<{ key: string; count: number }>;
  now: Date;
}): WeeklyTrainingPlanItem[] {
  return buildDailyPlan(nextWeekDailyMinutes, sessions, weakTargets.length > 0, { now }).map((step) =>
    buildNextWeekPlanItem(step, weakTargets, weakKeys),
  );
}

function buildNextWeekPlanItem(
  step: DailyPlanStep,
  weakTargets: Array<{ target: string; count: number }>,
  weakKeys: Array<{ key: string; count: number }>,
): WeeklyTrainingPlanItem {
  return {
    id: step.id,
    mode: step.mode,
    title: step.title,
    minutesPerSession: step.minutes,
    sessionsPerWeek: plannedTrainingDays,
    weeklyMinutes: step.minutes * plannedTrainingDays,
    goal: step.goal,
    acceptance: buildAcceptance(step, weakTargets, weakKeys),
  };
}

function buildAcceptance(
  step: DailyPlanStep,
  weakTargets: Array<{ target: string; count: number }>,
  weakKeys: Array<{ key: string; count: number }>,
): string {
  if (step.mode === "english") {
    return "先补足 5 轮英文基线，再累计到 20 轮有效稳定窗口；近 20 轮有效样本 >=80 CPM、准确率 >=96%、退格 <=10/100；达标后继续向 100 CPM 推进。";
  }
  if (step.mode === "code") {
    return "先补足 5 轮代码基线，再累计到 20 轮有效稳定窗口；近 20 轮有效样本 >=80 CPM、准确率 >=96%、退格 <=12/100；达标后继续向 100 CPM 推进。";
  }
  if (step.mode === "vim") {
    const weakKeyText = weakKeys[0] ? `重点照顾 ${weakKeys[0].key} 键。` : "重点保持 motion、operator 和命令节奏。";
    return `完成 >=5 轮 Vim/命令 kata；退格 <=15/100，最长停顿低于 3 秒。${weakKeyText}`;
  }
  if (step.id === "wubi-maintenance") {
    return "完成 >=5 轮低量维护；只练字根、一级简码和最近弱项，不用中文速度作为本周验收。";
  }
  if (step.id === "weak-review") {
    return weakTargets[0]
      ? `本周 Top 弱项「${weakTargets[0].target}」至少无提示正确 2 次；提示过的字词必须进入复练。`
      : "建立弱项基线；记录提示、错码和长停顿最多的字词。";
  }
  if (step.id === "professional-terms") {
    return "新增或复练 >=10 个专业词；稳定词进入材料包，仍停顿的词保留在弱项队列。";
  }
  if (step.mode === "wubi-code") {
    return "完成 >=5 轮五笔编码；准确率 >=90%，提示次数下降，退格 <=15/100。";
  }
  if (step.mode === "chinese-real") {
    return "完成 >=5 轮真实中文；准确率 >=90%，记录退格和最长停顿，中文先稳到 35-45 CPM。";
  }
  return "完成计划训练并记录速度、准确率、退格和停顿。";
}

function modeLabel(mode: TrainingMode): string {
  if (mode === "english") return "英文";
  if (mode === "code") return "代码";
  if (mode === "vim") return "Vim";
  if (mode === "wubi-code") return "五笔";
  return "真实中文";
}

function filterByDateRange(
  sessions: TrainingSession[],
  start: string,
  end: string,
): TrainingSession[] {
  return sessions.filter((session) => {
    const key = localDateKey(session.startedAt);
    return key >= start && key <= end;
  });
}

function sumMinutes(sessions: TrainingSession[]): number {
  return Number(sessions.reduce((sum, session) => sum + session.durationMs / 60000, 0).toFixed(1));
}

function countActiveDays(sessions: TrainingSession[]): number {
  return new Set(sessions.map((session) => localDateKey(session.startedAt))).size;
}

function delta(current: number, previous: number): number {
  return Number((current - previous).toFixed(1));
}
