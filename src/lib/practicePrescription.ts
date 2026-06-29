import type { TrainingMode, TrainingSession } from "../types";
import {
  describeFoundationSampleQuality,
  isFoundationQualitySession,
} from "./trainingPlan";

export type PracticePrescriptionSeverity = "stable" | "attention" | "repair";
export type PracticePrescriptionDecision = "continue" | "retry" | "protect";

export interface PracticePrescriptionRecommendation {
  mode: TrainingMode;
  targetText: string;
  reasons: string[];
}

export interface PracticeFoundationCredit {
  credited: boolean;
  label: string;
  detail: string;
}

export interface PracticePrescription {
  severity: PracticePrescriptionSeverity;
  decision: PracticePrescriptionDecision;
  decisionLabel: string;
  canAdvanceQueue: boolean;
  foundationCredit?: PracticeFoundationCredit;
  title: string;
  diagnosis: string;
  nextAction: string;
  queueAdvice: string;
  guardrail: string;
}

export function buildPracticePrescription(
  session: TrainingSession,
  recommendation: PracticePrescriptionRecommendation | null = null,
): PracticePrescription {
  const reasonText = recommendation?.reasons.slice(0, 2).join(" / ");
  const nextTarget = recommendation
    ? `达标后再练「${recommendation.targetText}」。`
    : "达标后再进入同类材料。";
  const nextTargetWithReason = `${nextTarget}${reasonText ? ` 选择原因：${reasonText}。` : ""}`;
  const foundationCredit = buildFoundationCredit(session);

  if (session.metrics.accuracy < 94) {
    return {
      severity: "repair",
      decision: "retry",
      decisionLabel: "重练当前组",
      canAdvanceQueue: false,
      foundationCredit,
      title: "先修准确率",
      diagnosis: `本轮准确率 ${session.metrics.accuracy}%，错误已经足以污染速度判断。`,
      nextAction: `当前组先重练一次，主动降速到可控输入。${nextTargetWithReason}`,
      queueAdvice: "准确率低于 94% 时先不要推进队列；重练到 96% 以上再进入下一组。",
      guardrail: "下一轮主动降速，目标先把准确率拉回 96% 以上，再看 CPM。",
    };
  }

  if (session.metrics.hintCount > 0) {
    return {
      severity: "repair",
      decision: "retry",
      decisionLabel: "无提示重练",
      canAdvanceQueue: false,
      foundationCredit,
      title: "减少提示依赖",
      diagnosis: `本轮使用 ${session.metrics.hintCount} 次提示，说明目标还没有形成稳定回忆。`,
      nextAction: `当前组先做一次无提示重练；开始前复述拆分、键位或命令。${nextTargetWithReason}`,
      queueAdvice: "已经使用提示的轮次不计为通过；先无提示完成当前组，再继续今日队列。",
      guardrail: "同一材料下一轮尽量不按 z/?；超过 3 秒再提示，并记录为弱项。",
    };
  }

  const backspaceTarget = getBackspaceTarget(session.mode);
  if (session.metrics.backspacePer100Chars > backspaceTarget) {
    return {
      severity: "attention",
      decision: "protect",
      decisionLabel: "降速保护",
      canAdvanceQueue: false,
      foundationCredit,
      title: "降低退格率",
      diagnosis: `本轮退格 ${session.metrics.backspacePer100Chars}/100 字，高于当前模式目标 ${backspaceTarget}/100。`,
      nextAction: `当前组先降速重练一次，目标是一次输入正确。${nextTargetWithReason}`,
      queueAdvice: "退格率超过当前模式目标，先做保护性重练，避免把修正动作固化进后续队列。",
      guardrail: "下一轮若退格继续偏高，缩短到仍满足有效样本的材料并暂停提速。",
    };
  }

  if (session.metrics.pauseCountOver1500Ms > 2 || session.metrics.maxPauseMs >= 3000) {
    return {
      severity: "attention",
      decision: "protect",
      decisionLabel: "停顿复盘",
      canAdvanceQueue: false,
      foundationCredit,
      title: "处理长停顿",
      diagnosis: `本轮出现 ${session.metrics.pauseCountOver1500Ms} 次长停顿，最长 ${session.metrics.maxPauseMs}ms。`,
      nextAction: `先复盘停顿位置，再重练当前组一次。${nextTargetWithReason}`,
      queueAdvice: "长停顿说明当前材料还没自动化；先定位卡点并重练，再继续下一组。",
      guardrail: "长停顿超过 3 秒时不要硬冲，把目标加入弱项复练。",
    };
  }

  const foundationSampleIssue = describeFoundationSampleQuality(session);
  if (foundationSampleIssue) {
    return {
      severity: "attention",
      decision: "continue",
      decisionLabel: "热身通过",
      canAdvanceQueue: true,
      foundationCredit,
      title: "不计入底座",
      diagnosis: foundationSampleIssue,
      nextAction: `这轮可以作为热身保留；下一组换一条更长的有效样本，再判断 80 CPM 底座。${nextTargetWithReason}`,
      queueAdvice: "短轮次可以继续队列，但不会计入英文/代码 5 轮基线、20 轮稳定窗口或 14 天复测有效期。",
      guardrail: "英文/代码底座样本至少 12 秒，材料和实际输入都至少 10 个单位；太短时不要用 CPM 判断阶段。",
    };
  }

  if ((session.mode === "english" || session.mode === "code") && session.metrics.charsPerMinute < 80) {
    return {
      severity: "attention",
      decision: "protect",
      decisionLabel: "提速重练",
      canAdvanceQueue: false,
      foundationCredit,
      title: "在稳定基础上提速",
      diagnosis: `本轮 ${session.metrics.charsPerMinute} CPM，准确率已可用，但还没到 80 CPM 底座线。`,
      nextAction: `当前组做一次轻微提速重练，目标先到 80 CPM。${nextTargetWithReason}`,
      queueAdvice: "英文/代码底座未过 80 CPM 时，优先把当前材料提速到门槛，再继续队列。",
      guardrail: "提速时准确率不能低于 96%，退格不能超过模式目标。",
    };
  }

  return {
    severity: "stable",
    decision: "continue",
    decisionLabel: "通过，可继续",
    canAdvanceQueue: true,
    foundationCredit,
    title: "本轮稳定",
    diagnosis: `本轮 ${session.metrics.charsPerMinute} CPM、${session.metrics.accuracy}% 准确率，修正成本可控。`,
    nextAction: recommendation
      ? `继续队列，下一组练「${recommendation.targetText}」。${reasonText ? ` 选择原因：${reasonText}。` : ""}`
      : "下一组可以增加材料长度或难度。",
    queueAdvice: "本轮达到推进标准，可以进入下一组或增加一点材料难度。",
    guardrail: "继续保持准确率优先；连续两轮稳定后再增加难度或切到下一阶段材料。",
  };
}

function getBackspaceTarget(mode: TrainingMode): number {
  if (mode === "english") return 10;
  if (mode === "code") return 12;
  return 15;
}

function buildFoundationCredit(session: TrainingSession): PracticeFoundationCredit | undefined {
  if (session.mode !== "english" && session.mode !== "code") return undefined;
  const qualityIssue = describeFoundationSampleQuality(session);
  const credited = isFoundationQualitySession(session);

  if (credited) {
    return {
      credited: true,
      label: "计入底座",
      detail: "本轮会进入英文/代码基线、20 轮稳定窗口和 14 天复测统计；速度、准确率和退格仍按实际表现参与门槛判断。",
    };
  }

  return {
    credited: false,
    label: "不计入底座",
    detail: qualityIssue ?? "本轮不会进入英文/代码底座统计。",
  };
}
