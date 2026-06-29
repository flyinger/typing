import type { SessionMetrics, TrainingMode, TrainingSession } from "../types";
import { startOfLocalDate } from "./date";
import { averageMetrics, getRecentSessions } from "./metrics";

export interface DailyPlanStep {
  id: string;
  minutes: number;
  mode: TrainingMode;
  title: string;
  goal: string;
}

interface DailyPlanOptions {
  minTargetMinutes?: number;
  now?: Date;
  freshnessDays?: number;
}

export interface FoundationEvaluationOptions {
  now?: Date;
  freshnessDays?: number;
}

export interface TrainingStage {
  label: string;
  target: string;
  focus: string;
}

export interface TrainingProtocol {
  title: string;
  summary: string;
  primaryMode: TrainingMode;
  exitCriteria: string[];
  guardrails: string[];
  reviewChecklist: string[];
}

export type TrainingRoadmapPhaseStatus = "active" | "ready" | "done" | "locked";

export interface TrainingRoadmapPhase {
  id: "foundation" | "wubi-accuracy" | "chinese-migration" | "production";
  title: string;
  status: TrainingRoadmapPhaseStatus;
  progress: number;
  metric: string;
  target: string;
  nextAction: string;
}

export interface FoundationStatus {
  englishSessions: number;
  codeSessions: number;
  englishQualifiedSessions: number;
  codeQualifiedSessions: number;
  englishStableSamples: number;
  codeStableSamples: number;
  englishLastPracticedAt?: string;
  codeLastPracticedAt?: string;
  englishDaysSincePractice: number | null;
  codeDaysSincePractice: number | null;
  englishFresh: boolean;
  codeFresh: boolean;
  englishCpm: number;
  codeCpm: number;
  englishAccuracy: number;
  codeAccuracy: number;
  englishBackspacePer100Chars: number;
  codeBackspacePer100Chars: number;
  ready: boolean;
}

export interface FoundationGate {
  id: string;
  label: string;
  current: string;
  target: string;
  passed: boolean;
}

export interface FoundationReport {
  status: FoundationStatus;
  gates: FoundationGate[];
  completedGates: number;
  totalGates: number;
  recommendation: string;
}

export type FoundationLiveSampleState = "not-foundation" | "waiting" | "ready" | "blocked";

export interface FoundationLiveSampleCheck {
  id: "duration" | "material" | "typed" | "hint" | "paste";
  label: string;
  current: string;
  target: string;
  passed: boolean;
  blocking: boolean;
}

export interface FoundationLiveSampleStatus {
  applies: boolean;
  state: FoundationLiveSampleState;
  label: string;
  detail: string;
  checks: FoundationLiveSampleCheck[];
}

export type FoundationSprintPhase =
  | "baseline"
  | "unlock"
  | "wubi-unlocked"
  | "comfort";

export interface FoundationSprintBlock {
  id: string;
  mode: TrainingMode;
  title: string;
  minutes: number;
  role: "primary" | "support" | "maintenance";
  goal: string;
  acceptance: string;
}

export interface FoundationSprintPlan {
  phase: FoundationSprintPhase;
  headline: string;
  strategy: string;
  focusMode: TrainingMode;
  focusLabel: string;
  targetSummary: string;
  estimatedSessionsToUnlock: number;
  estimatedFastTrainingDaysToUnlock: number;
  estimatedTrainingDaysToUnlock: number;
  blocks: FoundationSprintBlock[];
  rules: string[];
  milestones: string[];
}

const foundationTargets = {
  baselineSamples: 5,
  stableSamples: 20,
  freshnessDays: 14,
  minSampleDurationMs: 12000,
  minSampleUnits: 10,
  cpm: 80,
  stretchCpm: 100,
  accuracy: 96,
  englishBackspacePer100Chars: 10,
  codeBackspacePer100Chars: 12,
};

export function buildDailyPlan(
  targetMinutes: number,
  sessions: TrainingSession[],
  hasWeakTargets: boolean,
  options: DailyPlanOptions = {},
): DailyPlanStep[] {
  const normalizedTarget = Math.max(options.minTargetMinutes ?? 5, Math.round(targetMinutes));
  if (normalizedTarget < 15) {
    return [buildCompactFocusStep(normalizedTarget, sessions, hasWeakTargets, options)];
  }

  const scale = normalizedTarget / 20;
  const foundation = getFoundationStatus(sessions, options);
  const foundationFocusMode = getFoundationFocusMode(sessions, options);
  const foundationMaintenanceMode = getFoundationMaintenanceMode(sessions, options);
  const rawSteps: DailyPlanStep[] = foundation.ready
    ? [
        {
          id: "wubi-roots",
          minutes: Math.max(3, Math.round(4 * scale)),
          mode: "wubi-code",
          title: "字根/简码",
          goal: "英文/代码底座达标后，开始系统推进五笔。",
        },
        {
          id: "weak-review",
          minutes: Math.max(4, Math.round(5 * scale)),
          mode: "wubi-code",
          title: hasWeakTargets ? "弱字弱词" : "高频基础字词",
          goal: hasWeakTargets ? "复练最近错误和提示过的字词。" : "建立五笔弱项基线。",
        },
        {
          id: "real-chinese",
          minutes: Math.max(5, Math.round(6 * scale)),
          mode: "chinese-real",
          title: "真实中文",
          goal: "观察退格、停顿和上屏稳定性。",
        },
        {
          id: "professional-terms",
          minutes: Math.max(3, Math.round(3 * scale)),
          mode: "wubi-code",
          title: "专业词组",
          goal: "机器人、仿真、视觉伺服等个人专业词。",
        },
        {
          id: "english-code-maintenance",
          minutes: Math.max(2, normalizedTarget - Math.round(18 * scale)),
          mode: foundationMaintenanceMode,
          title: foundationMaintenanceMode === "english" ? "英文维护冲 100" : "代码维护冲 100",
          goal: "五笔主线开始后，继续把较弱的技术输入底座推向 100 CPM 舒适线。",
        },
      ]
    : buildFoundationDailyPlan(normalizedTarget, scale, foundationFocusMode);

  return normalizePlanTotal(rawSteps, normalizedTarget);
}

export function buildRemainingDailyPlan(
  targetMinutes: number,
  completedMinutes: number,
  sessions: TrainingSession[],
  hasWeakTargets: boolean,
  options: FoundationEvaluationOptions = {},
): DailyPlanStep[] {
  const remainingMinutes = Math.max(0, Math.ceil(targetMinutes - completedMinutes));
  if (remainingMinutes <= 0) return [];
  return buildDailyPlan(remainingMinutes, sessions, hasWeakTargets, { ...options, minTargetMinutes: 1 });
}

export function buildFoundationSprintPlan(
  sessions: TrainingSession[],
  targetMinutes = 20,
  hasWeakTargets = false,
  options: FoundationEvaluationOptions = {},
): FoundationSprintPlan {
  const report = getFoundationReport(sessions, options);
  const status = report.status;
  const focusMode = buildSprintFocusMode(sessions, report, options);
  const foundationReady = status.ready;
  const comfortReady =
    foundationReady &&
    status.englishCpm >= foundationTargets.stretchCpm &&
    status.codeCpm >= foundationTargets.stretchCpm;
  const phase: FoundationSprintPhase = comfortReady
    ? "comfort"
    : foundationReady
      ? "wubi-unlocked"
      : hasSampleDeficit(status)
        ? "baseline"
        : "unlock";
  const blocks = buildDailyPlan(targetMinutes, sessions, hasWeakTargets, options).map((step, index) =>
    buildFoundationSprintBlock(step, foundationReady, index),
  );
  const unlockEstimate = estimateFoundationUnlockByMode(report);
  const estimatedSessionsToUnlock = foundationReady ? 0 : unlockEstimate.english + unlockEstimate.code;
  const estimatedFastTrainingDaysToUnlock = foundationReady
    ? 0
    : estimateFastFoundationTrainingDays(unlockEstimate, blocks);
  const estimatedTrainingDaysToUnlock = foundationReady
    ? 0
    : Math.max(1, Math.max(unlockEstimate.english, unlockEstimate.code));

  return {
    phase,
    headline: buildFoundationSprintHeadline(phase, focusMode),
    strategy: buildFoundationSprintStrategy(phase),
    focusMode,
    focusLabel: modeFocusLabel(focusMode),
    targetSummary: `80 CPM 解锁五笔主线；100 CPM 是英文/代码维护舒适线；准确率必须 >= ${foundationTargets.accuracy}%。`,
    estimatedSessionsToUnlock,
    estimatedFastTrainingDaysToUnlock,
    estimatedTrainingDaysToUnlock,
    blocks,
    rules: buildFoundationSprintRules(phase, focusMode),
    milestones: buildFoundationSprintMilestones(status),
  };
}

export function getFoundationFocusMode(
  sessions: TrainingSession[],
  options: FoundationEvaluationOptions = {},
): "english" | "code" | "wubi-code" {
  const report = getFoundationReport(sessions, options);
  if (report.status.ready) return "wubi-code";
  const openGate = report.gates.find((gate) => !gate.passed);
  return openGate?.id.startsWith("code") ? "code" : "english";
}

export function getFoundationMaintenanceMode(
  sessions: TrainingSession[],
  options: FoundationEvaluationOptions = {},
): "english" | "code" {
  const status = getFoundationStatus(sessions, options);
  const englishGap = buildFoundationMaintenanceGap(
    status.englishCpm,
    status.englishAccuracy,
    status.englishBackspacePer100Chars,
    foundationTargets.englishBackspacePer100Chars,
  );
  const codeGap = buildFoundationMaintenanceGap(
    status.codeCpm,
    status.codeAccuracy,
    status.codeBackspacePer100Chars,
    foundationTargets.codeBackspacePer100Chars,
  );

  return codeGap > englishGap ? "code" : "english";
}

export function buildFoundationModeAdvice(
  mode: "english" | "code",
  totalSessions: number,
  recent: Pick<SessionMetrics, "charsPerMinute" | "accuracy" | "backspacePer100Chars">,
  targetBackspacePer100Chars = mode === "english"
    ? foundationTargets.englishBackspacePer100Chars
    : foundationTargets.codeBackspacePer100Chars,
): string {
  const modeLabel = mode === "english" ? "英文" : "代码";
  const stableSamples = Math.min(totalSessions, foundationTargets.stableSamples);

  if (totalSessions < foundationTargets.baselineSamples) {
    return `先补齐 ${modeLabel} ${foundationTargets.baselineSamples} 轮有效基线样本（当前 ${totalSessions}/${foundationTargets.baselineSamples}）。`;
  }

  if (totalSessions < foundationTargets.stableSamples) {
    const stableWindow = `稳定窗口 ${stableSamples}/${foundationTargets.stableSamples}`;
    if (recent.charsPerMinute < foundationTargets.cpm) {
      return `${stableWindow}，下一轮用短但仍合格的材料把速度推向 ${foundationTargets.cpm} CPM，暂不切五笔主线。`;
    }
    if (recent.accuracy < foundationTargets.accuracy) {
      return `${stableWindow}，速度已接近，下一轮降速把准确率压回 ${foundationTargets.accuracy}% 以上。`;
    }
    if (recent.backspacePer100Chars > targetBackspacePer100Chars) {
      return `${stableWindow}，退格仍偏高，下一轮练一次输入稳定性。`;
    }
    return `${stableWindow}，指标已到线，继续累计到 ${foundationTargets.stableSamples} 轮后再判断切五笔。`;
  }

  if (recent.charsPerMinute < foundationTargets.cpm) {
    return `近 ${foundationTargets.stableSamples} 轮速度未达 ${foundationTargets.cpm} CPM，下一轮用短但仍合格的材料提速。`;
  }
  if (recent.accuracy < foundationTargets.accuracy) {
    return `近 ${foundationTargets.stableSamples} 轮准确率未达 ${foundationTargets.accuracy}%，下一轮降速压准确率。`;
  }
  if (recent.backspacePer100Chars > targetBackspacePer100Chars) {
    return `近 ${foundationTargets.stableSamples} 轮退格偏高，下一轮减少修正动作。`;
  }
  return `本项近 ${foundationTargets.stableSamples} 轮达标，进入维护；若另一项未达标，主训练让给短板。`;
}

function buildSprintFocusMode(
  sessions: TrainingSession[],
  report: FoundationReport,
  options: FoundationEvaluationOptions,
): TrainingMode {
  if (report.status.ready) return getFoundationMaintenanceMode(sessions, options);
  return getFoundationFocusMode(sessions, options);
}

function hasSampleDeficit(status: FoundationStatus): boolean {
  return (
    status.englishQualifiedSessions < foundationTargets.baselineSamples ||
    status.codeQualifiedSessions < foundationTargets.baselineSamples
  );
}

function buildFoundationSprintBlock(
  step: DailyPlanStep,
  foundationReady: boolean,
  index: number,
): FoundationSprintBlock {
  const isFoundationMode = step.mode === "english" || step.mode === "code";
  const role: FoundationSprintBlock["role"] = foundationReady
    ? isFoundationMode
      ? "maintenance"
      : index === 0
        ? "primary"
        : "support"
    : isFoundationMode
      ? index === 0
        ? "primary"
        : "support"
      : "maintenance";

  return {
    id: step.id,
    mode: step.mode,
    title: step.title,
    minutes: step.minutes,
    role,
    goal: step.goal,
    acceptance: buildSprintBlockAcceptance(step, foundationReady),
  };
}

function buildSprintBlockAcceptance(
  step: DailyPlanStep,
  foundationReady: boolean,
): string {
  if (step.mode === "english") {
    return foundationReady
      ? `保持 >= ${foundationTargets.cpm} CPM，继续向 ${foundationTargets.stretchCpm} CPM 推进，退格 <= ${foundationTargets.englishBackspacePer100Chars}/100。`
      : `本轮准确率 >= ${foundationTargets.accuracy}%，退格 <= ${foundationTargets.englishBackspacePer100Chars}/100，速度向 ${foundationTargets.cpm} CPM 靠近。`;
  }
  if (step.mode === "code") {
    return foundationReady
      ? `保持 >= ${foundationTargets.cpm} CPM，继续向 ${foundationTargets.stretchCpm} CPM 推进，退格 <= ${foundationTargets.codeBackspacePer100Chars}/100。`
      : `本轮准确率 >= ${foundationTargets.accuracy}%，退格 <= ${foundationTargets.codeBackspacePer100Chars}/100，速度向 ${foundationTargets.cpm} CPM 靠近。`;
  }
  if (step.mode === "vim") {
    return "保持命令序列和 motion 手感，不抢主训练时间。";
  }
  if (foundationReady) {
    return step.mode === "chinese-real"
      ? "真实中文先看退格、停顿和上屏稳定性，不急着追最高速度。"
      : "无提示完成当前材料；提示或长停顿进入弱项复练。";
  }
  return "五笔只做低量维护，不提前追中文速度。";
}

function estimateFoundationUnlockByMode(report: FoundationReport): { english: number; code: number } {
  const status = report.status;
  const englishSampleGap = Math.max(0, foundationTargets.stableSamples - status.englishQualifiedSessions);
  const codeSampleGap = Math.max(0, foundationTargets.stableSamples - status.codeQualifiedSessions);
  const englishMetricGap =
    englishSampleGap === 0 &&
    report.gates.some((gate) => gate.id.startsWith("english-") && !gate.passed)
      ? foundationTargets.baselineSamples
      : 0;
  const codeMetricGap =
    codeSampleGap === 0 &&
    report.gates.some((gate) => gate.id.startsWith("code-") && !gate.passed)
      ? foundationTargets.baselineSamples
      : 0;

  return {
    english: englishSampleGap + englishMetricGap,
    code: codeSampleGap + codeMetricGap,
  };
}

function estimateFastFoundationTrainingDays(
  estimate: { english: number; code: number },
  blocks: FoundationSprintBlock[],
): number {
  const englishRoundsPerDay = estimateFoundationRoundsPerDay(blocks, "english");
  const codeRoundsPerDay = estimateFoundationRoundsPerDay(blocks, "code");
  const englishDays = Math.ceil(estimate.english / englishRoundsPerDay);
  const codeDays = Math.ceil(estimate.code / codeRoundsPerDay);

  return Math.max(1, englishDays, codeDays);
}

function estimateFoundationRoundsPerDay(
  blocks: FoundationSprintBlock[],
  mode: "english" | "code",
): number {
  const minutes = blocks
    .filter((block) => block.mode === mode)
    .reduce((sum, block) => sum + block.minutes, 0);
  if (minutes <= 0) return 1;
  return Math.max(1, Math.ceil(minutes / 2));
}

function buildFoundationSprintHeadline(
  phase: FoundationSprintPhase,
  focusMode: TrainingMode,
): string {
  if (phase === "comfort") {
    return "英文/代码底座已进入维护区，主训练应长期放在五笔和真实中文。";
  }
  if (phase === "wubi-unlocked") {
    return "80 CPM 已解锁五笔主线，不必等到 100 CPM 再开始中文迁移。";
  }
  if (phase === "baseline") {
    return "先补齐英文和代码有效基线样本，再判断速度是否真的卡住。";
  }
  return `${modeFocusLabel(focusMode)}是当前最短板，先把它推过 80 CPM 解锁线。`;
}

function buildFoundationSprintStrategy(phase: FoundationSprintPhase): string {
  if (phase === "comfort") {
    return "后续只保留少量英文/代码维护，重点用五笔完成真实中文、专业词和长文输入。";
  }
  if (phase === "wubi-unlocked") {
    return "每日主训练切给五笔编码、弱字弱词和真实中文；英文/代码保留 2 分钟维护，继续向 100 CPM 推进。";
  }
  return "每日优先英文/代码，再做 Vim/命令和五笔低量维护；准确率和退格达标前，不用中文速度作为主目标。";
}

function buildFoundationSprintRules(
  phase: FoundationSprintPhase,
  focusMode: TrainingMode,
): string[] {
  const focusLabel = modeFocusLabel(focusMode);
  if (phase === "comfort") {
    return [
      "英文/代码只做维护和复测，避免重新抢占中文主训练时间。",
      "五笔训练以无提示正确、退格下降和真实段落稳定为主。",
      "每周仍复核英文/代码近 20 轮，跌破 80 CPM 时临时回补。",
    ];
  }
  if (phase === "wubi-unlocked") {
    return [
      "80 CPM 是切换线，100 CPM 是舒适线；切五笔后继续维护较弱底座。",
      "五笔主线开始后，英文/代码维护块不得挤掉弱字弱词和真实中文。",
      "若英文或代码回落到 80 CPM 以下，下一天先回补较弱项。",
    ];
  }
  return [
    `今天第一优先级是${focusLabel}，先追稳定输入，再追速度。`,
    "单轮准确率低于 94% 或退格超标时，下一组重练当前材料。",
    "五笔只维护字根和一级简码，避免底座未稳时提前追中文速度。",
  ];
}

function buildFoundationSprintMilestones(status: FoundationStatus): string[] {
  return [
    `英文：${status.englishStableSamples}/${foundationTargets.stableSamples} 轮稳定窗口 · ${formatFreshness(status.englishDaysSincePractice)}复测 · ${status.englishCpm} CPM · ${status.englishAccuracy}% · 退格 ${status.englishBackspacePer100Chars}/100`,
    `代码：${status.codeStableSamples}/${foundationTargets.stableSamples} 轮稳定窗口 · ${formatFreshness(status.codeDaysSincePractice)}复测 · ${status.codeCpm} CPM · ${status.codeAccuracy}% · 退格 ${status.codeBackspacePer100Chars}/100`,
    `有效样本：单轮至少 ${Math.round(foundationTargets.minSampleDurationMs / 1000)} 秒，材料和实际输入都至少 ${foundationTargets.minSampleUnits} 个单位，才进入底座稳定窗口`,
    `解锁线：英文/代码各满 ${foundationTargets.stableSamples} 轮有效稳定窗口，最近 ${foundationTargets.freshnessDays} 天内复测，且都 >= ${foundationTargets.cpm} CPM、准确率 >= ${foundationTargets.accuracy}%、退格达标`,
    `舒适线：英文/代码都 >= ${foundationTargets.stretchCpm} CPM 后进入长期低量维护`,
  ];
}

function modeFocusLabel(mode: TrainingMode): string {
  if (mode === "english") return "英文速度";
  if (mode === "code") return "代码符号";
  if (mode === "vim") return "Vim/命令";
  if (mode === "wubi-code") return "五笔编码";
  return "真实中文";
}

function buildFoundationDailyPlan(
  normalizedTarget: number,
  scale: number,
  focusMode: "english" | "code" | "wubi-code",
): DailyPlanStep[] {
  const englishStep: DailyPlanStep = {
    id: focusMode === "code" ? "english-maintenance" : "english-baseline",
    minutes: Math.max(focusMode === "code" ? 5 : 6, Math.round((focusMode === "code" ? 7 : 8) * scale)),
    mode: "english",
    title: focusMode === "code" ? "英文维护复测" : "英文速度底座",
    goal: focusMode === "code" ? "保持已达标英文手感，把主训练量让给代码。" : "先把英文技术短句推到 80-100 CPM。",
  };
  const codeStep: DailyPlanStep = {
    id: "code-symbols",
    minutes: Math.max(focusMode === "code" ? 6 : 5, Math.round((focusMode === "code" ? 8 : 7) * scale)),
    mode: "code",
    title: "代码符号",
    goal: "括号、引号、缩进、大小写和命名风格。",
  };
  const supportSteps: DailyPlanStep[] = [
    {
      id: "vim-commands",
      minutes: Math.max(2, Math.round(3 * scale)),
      mode: "vim",
      title: "Vim/命令",
      goal: "保持 motion、operator、CLI 命令手感。",
    },
    {
      id: "wubi-maintenance",
      minutes: Math.max(2, normalizedTarget - Math.round(18 * scale)),
      mode: "wubi-code",
      title: "五笔低量维护",
      goal: "只保留字根和一级简码熟悉度，暂不追中文速度。",
    },
  ];

  return focusMode === "code" ? [codeStep, englishStep, ...supportSteps] : [englishStep, codeStep, ...supportSteps];
}

function buildCompactFocusStep(
  minutes: number,
  sessions: TrainingSession[],
  hasWeakTargets: boolean,
  options: FoundationEvaluationOptions = {},
): DailyPlanStep {
  const protocol = buildTrainingProtocol(sessions, options);
  const compactSteps: Record<TrainingMode, Omit<DailyPlanStep, "minutes">> = {
    english: {
      id: "compact-english",
      mode: "english",
      title: "英文速度补足",
      goal: "短时间只练英文技术短句，把准确率和节奏打稳。",
    },
    code: {
      id: "compact-code",
      mode: "code",
      title: "代码符号补足",
      goal: "短时间集中练括号、引号、缩进和命名输入。",
    },
    vim: {
      id: "compact-vim",
      mode: "vim",
      title: "Vim/命令补足",
      goal: "用一组 motion、operator 或 CLI 命令保持手感。",
    },
    "wubi-code": {
      id: "compact-wubi-code",
      mode: "wubi-code",
      title: hasWeakTargets ? "弱字弱词补足" : "五笔编码补足",
      goal: hasWeakTargets ? "只复练最近错字、提示字和长停顿字。" : "短时间练字根、简码和高频基础字词。",
    },
    "chinese-real": {
      id: "compact-chinese-real",
      mode: "chinese-real",
      title: "真实中文补足",
      goal: "用一小段真实文本观察退格、停顿和上屏稳定性。",
    },
  };

  return {
    ...compactSteps[protocol.primaryMode],
    minutes,
  };
}

function normalizePlanTotal(steps: DailyPlanStep[], targetMinutes: number): DailyPlanStep[] {
  const adjustedSteps = steps.map((step) => ({ ...step }));
  let diff = adjustedSteps.reduce((sum, step) => sum + step.minutes, 0) - targetMinutes;

  if (diff > 0) {
    for (let index = adjustedSteps.length - 1; index >= 0 && diff > 0; index -= 1) {
      const removable = Math.min(diff, Math.max(0, adjustedSteps[index].minutes - 1));
      adjustedSteps[index].minutes -= removable;
      diff -= removable;
    }
  }

  if (diff < 0) {
    adjustedSteps[adjustedSteps.length - 1].minutes += Math.abs(diff);
  }

  return adjustedSteps;
}

export function getTrainingStage(
  sessions: TrainingSession[],
  options: FoundationEvaluationOptions = {},
): TrainingStage {
  const foundation = getFoundationStatus(sessions, options);
  const chineseAverages = averageMetrics(
    getRecentSessions(
      sessions.filter((session) => session.mode === "chinese-real" || session.mode === "wubi-code"),
      20,
    ),
  );

  if (!foundation.ready) {
    return {
      label: "第 1 阶段：英文/代码速度底座",
      target: "英文和代码先过 80 CPM 解锁线，再维护到 100 CPM 舒适线",
      focus: `当前英文 ${foundation.englishCpm} CPM、代码 ${foundation.codeCpm} CPM；先把工作流输入打顺，再加大五笔。`,
    };
  }

  if (chineseAverages.charsPerMinute < 45 || chineseAverages.accuracy < 90) {
    return {
      label: "第 2 阶段：五笔编码准确",
      target: "五笔/真实中文准确率 >= 90%，中文 35-45 CPM",
      focus: "用英文/代码底座支撑训练节奏，五笔先稳拆码、提示和退格。",
    };
  }

  if (chineseAverages.charsPerMinute < 70 || chineseAverages.backspacePer100Chars > 10) {
    return {
      label: "第 3 阶段：真实中文迁移",
      target: "真实中文 55-70 CPM，退格 <= 10/100 字",
      focus: "增加真实段落、专业词和长文连续输入。",
    };
  }

  return {
    label: "第 4 阶段：生产切换",
    target: "真实中文 >= 80 CPM，退格 <= 8/100 字",
    focus: "用五笔完成笔记、方案和长文输入。",
  };
}

export function buildTrainingRoadmap(
  sessions: TrainingSession[],
  options: FoundationEvaluationOptions = {},
): TrainingRoadmapPhase[] {
  const foundationReport = getFoundationReport(sessions, options);
  const foundation = foundationReport.status;
  const chineseSessions = sessions.filter((session) => session.mode === "chinese-real" || session.mode === "wubi-code");
  const chineseAverages = averageMetrics(getRecentSessions(chineseSessions, 20));
  const foundationStretchReady =
    foundation.ready &&
    foundation.englishCpm >= foundationTargets.stretchCpm &&
    foundation.codeCpm >= foundationTargets.stretchCpm;
  const wubiAccuracyReady =
    foundation.ready &&
    chineseSessions.length >= 10 &&
    chineseAverages.accuracy >= 90 &&
    chineseAverages.charsPerMinute >= 45;
  const chineseMigrationReady =
    wubiAccuracyReady &&
    chineseAverages.charsPerMinute >= 70 &&
    chineseAverages.backspacePer100Chars <= 10;
  const productionReady =
    chineseMigrationReady &&
    chineseAverages.charsPerMinute >= 80 &&
    chineseAverages.backspacePer100Chars <= 8;
  const maintenanceMode = getFoundationMaintenanceMode(sessions, options);

  return [
    {
      id: "foundation",
      title: "英文/代码速度底座",
      status: foundationStretchReady ? "done" : foundation.ready ? "ready" : "active",
      progress: foundation.ready
        ? clampProgress(
            Math.round(
              ((Math.min(foundation.englishCpm, foundationTargets.stretchCpm) +
                Math.min(foundation.codeCpm, foundationTargets.stretchCpm)) /
                (foundationTargets.stretchCpm * 2)) *
                100,
            ),
          )
        : clampProgress(Math.round((foundationReport.completedGates / foundationReport.totalGates) * 80)),
      metric: `英文 ${foundation.englishCpm} CPM · 代码 ${foundation.codeCpm} CPM`,
      target: `各 ${foundationTargets.stableSamples} 轮稳定窗口，解锁 ${foundationTargets.cpm} CPM，舒适线 ${foundationTargets.stretchCpm} CPM，准确率 >= ${foundationTargets.accuracy}%`,
      nextAction: foundation.ready
        ? `${maintenanceMode === "english" ? "英文" : "代码"}继续维护到 ${foundationTargets.stretchCpm} CPM，同时开始五笔主线。`
        : foundationReport.recommendation,
    },
    {
      id: "wubi-accuracy",
      title: "五笔编码准确",
      status: !foundation.ready ? "locked" : wubiAccuracyReady ? "done" : "active",
      progress: !foundation.ready
        ? 0
        : clampProgress(
            Math.round(
              (Math.min(chineseSessions.length, 10) / 10) * 35 +
                (Math.min(chineseAverages.accuracy, 90) / 90) * 35 +
                (Math.min(chineseAverages.charsPerMinute, 45) / 45) * 30,
            ),
          ),
      metric: `${chineseSessions.length} 轮 · ${chineseAverages.accuracy}% · ${chineseAverages.charsPerMinute} CPM`,
      target: "五笔/真实中文近 20 轮准确率 >= 90%，中文 35-45 CPM",
      nextAction: foundation.ready
        ? "主练字根、简码、弱字弱词；提示过的字词必须无提示重练。"
        : "先完成英文/代码底座，不提前追中文速度。",
    },
    {
      id: "chinese-migration",
      title: "真实中文迁移",
      status: !wubiAccuracyReady ? "locked" : chineseMigrationReady ? "done" : "active",
      progress: !wubiAccuracyReady
        ? 0
        : clampProgress(
            Math.round(
              (Math.min(chineseAverages.charsPerMinute, 70) / 70) * 65 +
                ((20 - Math.min(chineseAverages.backspacePer100Chars, 20)) / 20) * 35,
            ),
          ),
      metric: `${chineseAverages.charsPerMinute} CPM · 退格 ${chineseAverages.backspacePer100Chars}/100`,
      target: "真实中文 55-70 CPM，退格 <= 10/100 字",
      nextAction: wubiAccuracyReady
        ? "增加真实段落、专业词和长文连续输入，重点看退格与长停顿。"
        : "等五笔编码准确性达标后，再加长真实中文材料。",
    },
    {
      id: "production",
      title: "生产切换",
      status: !chineseMigrationReady ? "locked" : productionReady ? "done" : "active",
      progress: !chineseMigrationReady
        ? 0
        : clampProgress(
            Math.round(
              (Math.min(chineseAverages.charsPerMinute, 80) / 80) * 70 +
                ((16 - Math.min(chineseAverages.backspacePer100Chars, 16)) / 16) * 30,
            ),
          ),
      metric: `${chineseAverages.charsPerMinute} CPM · 退格 ${chineseAverages.backspacePer100Chars}/100`,
      target: "真实中文 >= 80 CPM，退格 <= 8/100 字",
      nextAction: chineseMigrationReady
        ? "把项目报告、技术笔记和复盘长文纳入训练，逐步替换生产输入。"
        : "先完成真实中文迁移，避免过早切换影响工作流。",
    },
  ];
}

export function buildTrainingProtocol(
  sessions: TrainingSession[],
  options: FoundationEvaluationOptions = {},
): TrainingProtocol {
  const foundationReport = getFoundationReport(sessions, options);
  const foundation = foundationReport.status;
  const evaluation = resolveFoundationEvaluation(sessions, options);
  const chineseAverages = averageMetrics(
    getRecentSessions(
      sessions.filter((session) => session.mode === "chinese-real" || session.mode === "wubi-code"),
      20,
    ),
  );

  if (!foundation.ready) {
    const openGate = foundationReport.gates.find((gate) => !gate.passed);
    return {
      title: "第 1 阶段执行协议：英文/代码速度底座",
      summary:
        "每日先完成英文和代码主训练，Vim 保持手感，五笔只做低量维护；80 CPM 是进入五笔主线的解锁线，100 CPM 是后续维护的舒适线。",
      primaryMode: openGate?.id.startsWith("code") ? "code" : "english",
      exitCriteria: [
        `英文和代码各至少 ${foundationTargets.baselineSamples} 轮有效基线样本`,
        `英文和代码各累计到 ${foundationTargets.stableSamples} 轮有效稳定窗口`,
        `有效轮次单轮至少 ${Math.round(foundationTargets.minSampleDurationMs / 1000)} 秒，材料和实际输入都至少 ${foundationTargets.minSampleUnits} 个单位`,
        `英文和代码最近复测都在 ${evaluation.freshnessDays} 天内`,
        "英文和代码近 20 轮平均速度都 >= 80 CPM",
        "英文或代码低于 100 CPM 时，五笔主线开启后仍保留维护训练",
        "英文和代码准确率都 >= 96%",
        "英文退格 <= 10/100 字，代码退格 <= 12/100 字",
      ],
      guardrails: [
        "任一轮准确率低于 94% 时，下一轮降低速度，只练短但仍合格的材料",
        "退格超过目标 1.5 倍时，下一轮禁止冲速，专练一次输入正确",
        "五笔维护只练字根、一级简码和最近弱项，不加入长文压力",
      ],
      reviewChecklist: [
        foundationReport.recommendation,
        `每 5 轮打开 Analytics 的底座冲刺页复核基线、稳定窗口、${evaluation.freshnessDays} 天有效期和质量门槛`,
        "英文/代码都过门槛后再进入五笔主线",
      ],
    };
  }

  if (chineseAverages.charsPerMinute < 45 || chineseAverages.accuracy < 90) {
    return {
      title: "第 2 阶段执行协议：五笔编码准确",
      summary:
        "英文/代码底座已可支撑训练节奏，今日主线转为五笔拆码、简码和弱字弱词。",
      primaryMode: "wubi-code",
      exitCriteria: [
        "五笔编码和真实中文近 20 轮准确率 >= 90%",
        "中文输入稳定到 35-45 CPM",
        "提示次数开始下降，弱字集中到少数类别",
      ],
      guardrails: [
        "提示用过的字词必须进入弱项复练，不把提示当作通过",
        "单字停顿超过 3 秒时，优先复盘拆码，不继续堆材料长度",
        "每天保留 2 分钟英文/代码维护，避免底座回退",
      ],
      reviewChecklist: [
        "复练最近错误、提示和长停顿字词",
        "把稳定的专业词加入个人材料包，再考虑同步到 Rime 用户词库",
        "每周导出同步包，确认 Mac 与 Ubuntu 统计能合并",
      ],
    };
  }

  if (chineseAverages.charsPerMinute < 70 || chineseAverages.backspacePer100Chars > 10) {
    return {
      title: "第 3 阶段执行协议：真实中文迁移",
      summary:
        "从编码正确转向真实写作稳定性，重点观察退格、长停顿和连续段落上屏成本。",
      primaryMode: "chinese-real",
      exitCriteria: [
        "真实中文稳定到 55-70 CPM",
        "退格 <= 10/100 字",
        "长文连续输入时最长停顿明显下降",
      ],
      guardrails: [
        "准确率下降时回到短段落和弱词复练，不直接加长文",
        "同一专业词反复停顿时，优先补个人词库和词组材料",
        "英文/代码只保留维护量，不重新抢占中文主训练时间",
      ],
      reviewChecklist: [
        "复盘最长停顿位置和退格集中段落",
        "每周做一次 500 字连续输入，检查真实工作迁移",
        "把项目报告、技术笔记和复盘文本加入中文真实材料",
      ],
    };
  }

  return {
    title: "第 4 阶段执行协议：生产切换",
    summary:
      "用五笔完成真实笔记、方案和项目复盘，训练系统转为维护、复盘和弱项捕获。",
    primaryMode: "chinese-real",
    exitCriteria: [
      "真实中文 >= 80 CPM",
      "退格 <= 8/100 字",
      "工作输入中不再因输入法选择回退到拼音",
    ],
    guardrails: [
      "连续两周退格或停顿回升时，恢复第 3 阶段短段落训练",
      "新增专业词先进入材料包，稳定后再同步到 Rime 用户词库",
      "同步目录或同步包必须保持可备份、可迁移、可重算",
    ],
    reviewChecklist: [
      "每周导出 CSV 或同步包，保留可恢复数据",
      "整理新增专业词、错词和高频工作句式",
      "保留每日 20 分钟维护训练，避免长期停练后回退",
    ],
  };
}

function buildFoundationMaintenanceGap(
  cpm: number,
  accuracy: number,
  backspacePer100Chars: number,
  backspaceTarget: number,
): number {
  const speedGap = Math.max(0, foundationTargets.stretchCpm - cpm) / foundationTargets.stretchCpm;
  const accuracyGap = Math.max(0, foundationTargets.accuracy - accuracy) / foundationTargets.accuracy;
  const backspaceGap = Math.max(0, backspacePer100Chars - backspaceTarget) / Math.max(1, backspaceTarget);
  return speedGap * 0.6 + accuracyGap * 0.25 + backspaceGap * 0.15;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function getFoundationStatus(
  sessions: TrainingSession[],
  options: FoundationEvaluationOptions = {},
): FoundationStatus {
  const englishSessions = sessions.filter((session) => session.mode === "english");
  const codeSessions = sessions.filter((session) => session.mode === "code");
  const qualifiedEnglishSessions = englishSessions.filter(isFoundationQualitySession);
  const qualifiedCodeSessions = codeSessions.filter(isFoundationQualitySession);
  const evaluation = resolveFoundationEvaluation(sessions, options);
  const recentEnglishSessions = getRecentSessions(qualifiedEnglishSessions, foundationTargets.stableSamples);
  const recentCodeSessions = getRecentSessions(qualifiedCodeSessions, foundationTargets.stableSamples);
  const englishAverage = averageMetrics(recentEnglishSessions);
  const codeAverage = averageMetrics(recentCodeSessions);
  const englishLastPracticedAt = latestSessionStartedAt(qualifiedEnglishSessions);
  const codeLastPracticedAt = latestSessionStartedAt(qualifiedCodeSessions);
  const englishDaysSincePractice = daysSincePractice(englishLastPracticedAt, evaluation.now);
  const codeDaysSincePractice = daysSincePractice(codeLastPracticedAt, evaluation.now);
  const englishFresh = isPracticeFresh(englishDaysSincePractice, evaluation.freshnessDays);
  const codeFresh = isPracticeFresh(codeDaysSincePractice, evaluation.freshnessDays);
  const hasEnoughSamples =
    qualifiedEnglishSessions.length >= foundationTargets.stableSamples &&
    qualifiedCodeSessions.length >= foundationTargets.stableSamples;
  const ready =
    hasEnoughSamples &&
    englishFresh &&
    codeFresh &&
    englishAverage.charsPerMinute >= foundationTargets.cpm &&
    codeAverage.charsPerMinute >= foundationTargets.cpm &&
    englishAverage.accuracy >= foundationTargets.accuracy &&
    codeAverage.accuracy >= foundationTargets.accuracy &&
    englishAverage.backspacePer100Chars <= foundationTargets.englishBackspacePer100Chars &&
    codeAverage.backspacePer100Chars <= foundationTargets.codeBackspacePer100Chars;

  return {
    englishSessions: englishSessions.length,
    codeSessions: codeSessions.length,
    englishQualifiedSessions: qualifiedEnglishSessions.length,
    codeQualifiedSessions: qualifiedCodeSessions.length,
    englishStableSamples: Math.min(qualifiedEnglishSessions.length, foundationTargets.stableSamples),
    codeStableSamples: Math.min(qualifiedCodeSessions.length, foundationTargets.stableSamples),
    englishLastPracticedAt,
    codeLastPracticedAt,
    englishDaysSincePractice,
    codeDaysSincePractice,
    englishFresh,
    codeFresh,
    englishCpm: englishAverage.charsPerMinute,
    codeCpm: codeAverage.charsPerMinute,
    englishAccuracy: englishAverage.accuracy,
    codeAccuracy: codeAverage.accuracy,
    englishBackspacePer100Chars: englishAverage.backspacePer100Chars,
    codeBackspacePer100Chars: codeAverage.backspacePer100Chars,
    ready,
  };
}

export function getFoundationReport(
  sessions: TrainingSession[],
  options: FoundationEvaluationOptions = {},
): FoundationReport {
  const evaluation = resolveFoundationEvaluation(sessions, options);
  const status = getFoundationStatus(sessions, evaluation);
  const gates: FoundationGate[] = [
    {
      id: "english-baseline",
      label: "英文基线样本",
      current: `${status.englishQualifiedSessions} 有效轮 / ${status.englishSessions} 总轮`,
      target: `>= ${foundationTargets.baselineSamples} 有效轮`,
      passed: status.englishQualifiedSessions >= foundationTargets.baselineSamples,
    },
    {
      id: "code-baseline",
      label: "代码基线样本",
      current: `${status.codeQualifiedSessions} 有效轮 / ${status.codeSessions} 总轮`,
      target: `>= ${foundationTargets.baselineSamples} 有效轮`,
      passed: status.codeQualifiedSessions >= foundationTargets.baselineSamples,
    },
    {
      id: "english-stability",
      label: "英文稳定窗口",
      current: `${status.englishStableSamples}/${foundationTargets.stableSamples} 有效轮`,
      target: `>= ${foundationTargets.stableSamples} 有效轮`,
      passed: status.englishQualifiedSessions >= foundationTargets.stableSamples,
    },
    {
      id: "code-stability",
      label: "代码稳定窗口",
      current: `${status.codeStableSamples}/${foundationTargets.stableSamples} 有效轮`,
      target: `>= ${foundationTargets.stableSamples} 有效轮`,
      passed: status.codeQualifiedSessions >= foundationTargets.stableSamples,
    },
    {
      id: "english-freshness",
      label: "英文复测有效期",
      current: formatFreshness(status.englishDaysSincePractice),
      target: `<= ${evaluation.freshnessDays} 天`,
      passed: status.englishFresh,
    },
    {
      id: "code-freshness",
      label: "代码复测有效期",
      current: formatFreshness(status.codeDaysSincePractice),
      target: `<= ${evaluation.freshnessDays} 天`,
      passed: status.codeFresh,
    },
    {
      id: "english-speed",
      label: "英文近 20 轮速度",
      current: `${status.englishCpm} CPM`,
      target: `>= ${foundationTargets.cpm} CPM`,
      passed:
        status.englishQualifiedSessions >= foundationTargets.stableSamples &&
        status.englishCpm >= foundationTargets.cpm,
    },
    {
      id: "english-accuracy",
      label: "英文近 20 轮准确率",
      current: `${status.englishAccuracy}%`,
      target: `>= ${foundationTargets.accuracy}%`,
      passed:
        status.englishQualifiedSessions >= foundationTargets.stableSamples &&
        status.englishAccuracy >= foundationTargets.accuracy,
    },
    {
      id: "english-backspace",
      label: "英文近 20 轮退格",
      current: `${status.englishBackspacePer100Chars}/100`,
      target: `<= ${foundationTargets.englishBackspacePer100Chars}/100`,
      passed:
        status.englishQualifiedSessions >= foundationTargets.stableSamples &&
        status.englishBackspacePer100Chars <= foundationTargets.englishBackspacePer100Chars,
    },
    {
      id: "code-speed",
      label: "代码近 20 轮速度",
      current: `${status.codeCpm} CPM`,
      target: `>= ${foundationTargets.cpm} CPM`,
      passed:
        status.codeQualifiedSessions >= foundationTargets.stableSamples &&
        status.codeCpm >= foundationTargets.cpm,
    },
    {
      id: "code-accuracy",
      label: "代码近 20 轮准确率",
      current: `${status.codeAccuracy}%`,
      target: `>= ${foundationTargets.accuracy}%`,
      passed:
        status.codeQualifiedSessions >= foundationTargets.stableSamples &&
        status.codeAccuracy >= foundationTargets.accuracy,
    },
    {
      id: "code-backspace",
      label: "代码近 20 轮退格",
      current: `${status.codeBackspacePer100Chars}/100`,
      target: `<= ${foundationTargets.codeBackspacePer100Chars}/100`,
      passed:
        status.codeQualifiedSessions >= foundationTargets.stableSamples &&
        status.codeBackspacePer100Chars <= foundationTargets.codeBackspacePer100Chars,
    },
  ];
  const completedGates = gates.filter((gate) => gate.passed).length;

  return {
    status,
    gates,
    completedGates,
    totalGates: gates.length,
    recommendation: buildFoundationRecommendation(status, gates),
  };
}

function buildFoundationRecommendation(
  status: FoundationStatus,
  gates: FoundationGate[],
): string {
  if (status.ready) {
    const maintenanceMode = status.codeCpm < status.englishCpm ? "代码" : "英文";
    return `英文/代码底座已达标，可以把主训练量切到五笔和真实中文，同时保留每日 2 分钟${maintenanceMode}维护。`;
  }

  const firstOpenGate = gates.find((gate) => !gate.passed);
  if (!firstOpenGate) {
    return "继续完成英文/代码复测，确认近 20 轮稳定后再切五笔主线。";
  }
  if (firstOpenGate.id.endsWith("baseline")) {
    return `先补足${firstOpenGate.label}，至少 ${foundationTargets.baselineSamples} 个有效轮次后再判断早期节奏；有效轮次单轮至少 ${Math.round(foundationTargets.minSampleDurationMs / 1000)} 秒，材料和实际输入都至少 ${foundationTargets.minSampleUnits} 个单位。`;
  }
  if (firstOpenGate.id.endsWith("stability")) {
    return `继续累计${firstOpenGate.label}，单轮至少 ${Math.round(foundationTargets.minSampleDurationMs / 1000)} 秒，材料和实际输入都至少 ${foundationTargets.minSampleUnits} 个单位；满 ${foundationTargets.stableSamples} 个有效轮次后再判断能否切五笔主线。`;
  }
  if (firstOpenGate.id.endsWith("freshness")) {
    return `${firstOpenGate.label}已过期，先做一轮复测；复测仍过 80 CPM、准确率和退格门槛后，再继续五笔主线。`;
  }
  if (firstOpenGate.id.endsWith("speed")) {
    return `${firstOpenGate.label}未达标，下一组优先练对应材料，目标先稳准确率再提速。`;
  }
  if (firstOpenGate.id.endsWith("accuracy")) {
    return `${firstOpenGate.label}未达标，下一组降低速度，避免为了 CPM 牺牲稳定性。`;
  }
  return `${firstOpenGate.label}偏高，下一组减少修正，优先一次输入正确。`;
}

function resolveFoundationEvaluation(
  sessions: TrainingSession[],
  options: FoundationEvaluationOptions = {},
): { now: Date; freshnessDays: number } {
  const latestStartedAt = latestSessionStartedAt(sessions);
  const fallbackNow = latestStartedAt ? new Date(latestStartedAt) : new Date();
  return {
    now: options.now ?? fallbackNow,
    freshnessDays: options.freshnessDays ?? foundationTargets.freshnessDays,
  };
}

export function isFoundationQualitySession(session: TrainingSession): boolean {
  return (
    (session.mode === "english" || session.mode === "code") &&
    (session.metrics.pasteEventCount ?? 0) === 0 &&
    session.metrics.hintCount === 0 &&
    session.durationMs >= foundationTargets.minSampleDurationMs &&
    session.metrics.totalUnits >= foundationTargets.minSampleUnits &&
    foundationTypedUnits(session) >= foundationTargets.minSampleUnits
  );
}

export function describeFoundationSampleQuality(session: TrainingSession): string | null {
  if (session.mode !== "english" && session.mode !== "code") return null;

  const issues: string[] = [];
  if ((session.metrics.pasteEventCount ?? 0) > 0) {
    issues.push(`本轮发生 ${session.metrics.pasteEventCount} 次粘贴或大段突增输入`);
  }
  if (session.metrics.hintCount > 0) {
    issues.push(`本轮使用 ${session.metrics.hintCount} 次提示`);
  }
  const durationSeconds = Math.round(session.durationMs / 1000);
  const targetSeconds = Math.round(foundationTargets.minSampleDurationMs / 1000);
  if (session.durationMs < foundationTargets.minSampleDurationMs) {
    issues.push(`本轮只有 ${durationSeconds} 秒，低于有效样本要求 ${targetSeconds} 秒`);
  }
  if (session.metrics.totalUnits < foundationTargets.minSampleUnits) {
    issues.push(`本轮材料只有 ${session.metrics.totalUnits} 个输入单位，低于有效样本要求 ${foundationTargets.minSampleUnits} 个`);
  }
  const typedUnits = foundationTypedUnits(session);
  if (typedUnits < foundationTargets.minSampleUnits) {
    issues.push(`本轮实际只输入 ${typedUnits} 个单位，低于有效样本要求 ${foundationTargets.minSampleUnits} 个`);
  }

  return issues.length
    ? `${issues.join("；")}。这轮不会计入英文/代码底座基线、稳定窗口或复测有效期。`
    : null;
}

export function buildFoundationLiveSampleStatus({
  mode,
  elapsedMs,
  targetText,
  inputText,
  hintCount,
  pasteEventCount,
}: {
  mode: TrainingMode;
  elapsedMs: number;
  targetText: string;
  inputText: string;
  hintCount: number;
  pasteEventCount: number;
}): FoundationLiveSampleStatus {
  if (mode !== "english" && mode !== "code") {
    return {
      applies: false,
      state: "not-foundation",
      label: "非底座模式",
      detail: "五笔、中文和 Vim 训练会记录表现，但不计入英文/代码 80 CPM 解锁窗口。",
      checks: [],
    };
  }

  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const targetSeconds = Math.round(foundationTargets.minSampleDurationMs / 1000);
  const targetUnits = targetText.trim().length;
  const typedUnits = inputText.trim().length;
  const checks: FoundationLiveSampleCheck[] = [
    {
      id: "duration",
      label: "训练时长",
      current: `${elapsedSeconds}s`,
      target: `>= ${targetSeconds}s`,
      passed: elapsedMs >= foundationTargets.minSampleDurationMs,
      blocking: false,
    },
    {
      id: "material",
      label: "材料长度",
      current: `${targetUnits} 单位`,
      target: `>= ${foundationTargets.minSampleUnits} 单位`,
      passed: targetUnits >= foundationTargets.minSampleUnits,
      blocking: targetUnits < foundationTargets.minSampleUnits,
    },
    {
      id: "typed",
      label: "实际输入",
      current: `${typedUnits} 单位`,
      target: `>= ${foundationTargets.minSampleUnits} 单位`,
      passed: typedUnits >= foundationTargets.minSampleUnits,
      blocking: false,
    },
    {
      id: "hint",
      label: "提示",
      current: `${hintCount} 次`,
      target: "0 次",
      passed: hintCount === 0,
      blocking: hintCount > 0,
    },
    {
      id: "paste",
      label: "粘贴/突增",
      current: `${pasteEventCount} 次`,
      target: "0 次",
      passed: pasteEventCount === 0,
      blocking: pasteEventCount > 0,
    },
  ];
  const blockingChecks = checks.filter((check) => check.blocking);
  const waitingChecks = checks.filter((check) => !check.passed && !check.blocking);

  if (blockingChecks.length > 0) {
    return {
      applies: true,
      state: "blocked",
      label: "本轮不计入底座",
      detail: `${blockingChecks.map((check) => check.label).join("、")}不满足有效样本要求；完成后会保留训练记录，但不会计入 5/20 轮底座窗口。`,
      checks,
    };
  }

  if (waitingChecks.length > 0) {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((foundationTargets.minSampleDurationMs - elapsedMs) / 1000),
    );
    const remainingUnits = Math.max(0, foundationTargets.minSampleUnits - typedUnits);
    const waitingParts = [
      remainingSeconds > 0 ? `再保持 ${remainingSeconds} 秒` : "",
      remainingUnits > 0 ? `再输入 ${remainingUnits} 个单位` : "",
    ].filter(Boolean);

    return {
      applies: true,
      state: "waiting",
      label: "还不能计入底座",
      detail: `${waitingParts.join("，") || "继续完成当前材料"}后，本轮才可能进入英文/代码基线和稳定窗口。`,
      checks,
    };
  }

  return {
    applies: true,
    state: "ready",
    label: "可计入底座",
    detail: "当前时长、材料长度、实际输入、提示和粘贴都满足有效样本要求；完成后会进入英文/代码底座统计。",
    checks,
  };
}

function foundationTypedUnits(session: TrainingSession): number {
  return session.inputText.trim().length;
}

function latestSessionStartedAt(sessions: TrainingSession[]): string | undefined {
  return sessions.reduce<string | undefined>((latest, session) => {
    if (!latest || session.startedAt > latest) return session.startedAt;
    return latest;
  }, undefined);
}

function daysSincePractice(startedAt: string | undefined, now: Date): number | null {
  if (!startedAt) return null;
  const startedDate = startOfLocalDate(new Date(startedAt));
  const nowDate = startOfLocalDate(now);
  const diffMs = nowDate.getTime() - startedDate.getTime();
  return Math.max(0, Math.floor(diffMs / 86400000));
}

function isPracticeFresh(daysSince: number | null, freshnessDays: number): boolean {
  return daysSince !== null && daysSince <= freshnessDays;
}

function formatFreshness(daysSince: number | null): string {
  if (daysSince === null) return "无记录";
  if (daysSince === 0) return "今天";
  return `${daysSince} 天前`;
}
