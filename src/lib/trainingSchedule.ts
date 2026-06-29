import type { TrainingMode, TrainingSession } from "../types";
import {
  buildFoundationSprintPlan,
  type FoundationSprintBlock,
  type FoundationEvaluationOptions,
  type FoundationSprintPhase,
} from "./trainingPlan";

export type TrainingScheduleDayKind = "foundation" | "transition" | "wubi-main" | "comfort";

export interface TrainingScheduleDay {
  day: number;
  kind: TrainingScheduleDayKind;
  phase: string;
  title: string;
  summary: string;
  minutes: number;
  blocks: FoundationSprintBlock[];
  checkpoint: boolean;
  acceptance: string[];
  syncAction?: string;
}

export interface TrainingSchedule {
  horizonDays: number;
  currentPhase: FoundationSprintPhase;
  headline: string;
  estimatedTrainingDaysToUnlock: number;
  estimatedFastTrainingDaysToUnlock: number;
  expectedSwitchDay?: number;
  days: TrainingScheduleDay[];
  reviewCadence: string[];
  caveats: string[];
}

export function buildTrainingSchedule(
  sessions: TrainingSession[],
  targetMinutes = 20,
  horizonDays = 20,
  hasWeakTargets = false,
  options: FoundationEvaluationOptions = {},
): TrainingSchedule {
  const normalizedTarget = Math.max(5, Math.round(targetMinutes));
  const normalizedHorizon = Math.max(5, Math.round(horizonDays));
  const freshnessDays = options.freshnessDays ?? 14;
  const sprint = buildFoundationSprintPlan(sessions, normalizedTarget, hasWeakTargets, options);
  const currentPhase = sprint.phase;
  const transitionDay =
    sprint.estimatedTrainingDaysToUnlock > 0 ? sprint.estimatedTrainingDaysToUnlock + 1 : 1;
  const switchDay = transitionDay <= normalizedHorizon ? transitionDay : undefined;
  const days = Array.from({ length: normalizedHorizon }, (_, index) => {
    const day = index + 1;
    const checkpoint = day % 5 === 0;
    const shouldStayFoundation =
      (currentPhase === "baseline" || currentPhase === "unlock") &&
      (!switchDay || day < switchDay);
    const shouldTransition =
      (currentPhase === "baseline" || currentPhase === "unlock") &&
      day === switchDay &&
      sprint.estimatedTrainingDaysToUnlock > 0;

    if (shouldStayFoundation) {
      return buildFoundationScheduleDay(day, normalizedTarget, sprint.blocks, checkpoint);
    }
    if (shouldTransition) {
      return buildTransitionScheduleDay(day, normalizedTarget, sprint.focusMode, checkpoint);
    }
    if (currentPhase === "comfort") {
      return buildComfortScheduleDay(day, normalizedTarget, sprint.focusMode, checkpoint);
    }
    return buildWubiMainScheduleDay(day, normalizedTarget, sprint.focusMode, checkpoint, hasWeakTargets);
  });

  return {
    horizonDays: normalizedHorizon,
    currentPhase,
    headline: buildScheduleHeadline(
      currentPhase,
      sprint.estimatedFastTrainingDaysToUnlock,
      sprint.estimatedTrainingDaysToUnlock,
      normalizedHorizon,
    ),
    estimatedTrainingDaysToUnlock: sprint.estimatedTrainingDaysToUnlock,
    estimatedFastTrainingDaysToUnlock: sprint.estimatedFastTrainingDaysToUnlock,
    expectedSwitchDay: sprint.estimatedTrainingDaysToUnlock > 0 ? switchDay : undefined,
    days,
    reviewCadence: [
      "每天训练结束看处方：准确率、退格、提示和长停顿任一项失控，下一组先重练。",
      `每 5 个训练日复核一次英文/代码有效稳定窗口、${freshnessDays} 天复测有效期和 80 CPM 门槛，并写入同步目录或导出同步包。`,
      `英文/代码各满 20 个有效轮次、最近 ${freshnessDays} 天内复测且 80 CPM 达标后切五笔主线；100 CPM 只作为英文/代码维护舒适线。`,
      "每周至少一次真实中文段落复盘，记录退格和最长停顿位置。",
    ],
    caveats: [
      "这是按当前数据生成的执行日程，不会替代每次训练后的处方保护。",
      "如果英文或代码回落到 80 CPM 以下，下一天临时回补较弱项。",
      "公司 Ubuntu 不方便自动同步时，按第 5/10/15/20 天手动导出同步包。",
    ],
  };
}

function buildFoundationScheduleDay(
  day: number,
  targetMinutes: number,
  blocks: FoundationSprintBlock[],
  checkpoint: boolean,
): TrainingScheduleDay {
  return {
    day,
    kind: "foundation",
    phase: "英文/代码底座",
    title: checkpoint ? "底座复测日" : "底座推进日",
    summary: checkpoint
      ? "完成英文和代码复测，决定下一周是否继续冲底座或切五笔。"
      : "先练英文/代码，再做 Vim 和五笔低量维护。",
    minutes: targetMinutes,
    blocks,
    checkpoint,
    acceptance: [
      "英文/代码训练准确率 >= 96%，退格不超标。",
      "英文和代码都未到 80 CPM 前，不用中文速度作为主目标。",
      checkpoint ? "复核基线、稳定窗口和质量门槛，并同步一次训练数据。" : "训练结束按处方决定重练或推进。",
    ],
    syncAction: checkpoint ? "写入同步目录或导出同步包。" : undefined,
  };
}

function buildTransitionScheduleDay(
  day: number,
  targetMinutes: number,
  maintenanceMode: TrainingMode,
  checkpoint: boolean,
): TrainingScheduleDay {
  return {
    day,
    kind: "transition",
    phase: "切换复测",
    title: "80 CPM 解锁复测",
    summary: "先复测英文/代码门槛；若通过，当天后半段开始五笔主线。",
    minutes: targetMinutes,
    blocks: [
      foundationBlock("transition-english", "english", "英文复测", 4, "primary", "确认英文仍在 80 CPM 以上。", ">=80 CPM、准确率 >=96%、退格 <=10/100。"),
      foundationBlock("transition-code", "code", "代码复测", 4, "primary", "确认代码符号仍在 80 CPM 以上。", ">=80 CPM、准确率 >=96%、退格 <=12/100。"),
      foundationBlock("transition-wubi", "wubi-code", "五笔主线启动", Math.max(4, targetMinutes - 10), "support", "开始字根、简码和弱字弱词。", "无提示完成，提示项进入弱项复练。"),
      foundationBlock("transition-maintenance", maintenanceMode, "较弱底座维护", 2, "maintenance", "保留英文/代码手感。", "100 CPM 不阻塞五笔，只做长期维护。"),
    ],
    checkpoint,
    acceptance: [
      "英文和代码都通过 80 CPM 门槛后，下一天进入五笔主线日。",
      "任一项未过门槛时，下一天继续底座推进日。",
      "当天完成一次同步，确保 Mac/Ubuntu 都能看到切换点。",
    ],
    syncAction: "写入同步目录或导出同步包。",
  };
}

function buildWubiMainScheduleDay(
  day: number,
  targetMinutes: number,
  maintenanceMode: TrainingMode,
  checkpoint: boolean,
  hasWeakTargets: boolean,
): TrainingScheduleDay {
  const blocks = buildWubiMainBlocks(targetMinutes, maintenanceMode, hasWeakTargets);
  return {
    day,
    kind: "wubi-main",
    phase: "五笔主线",
    title: checkpoint ? "五笔复盘日" : "五笔推进日",
    summary: checkpoint
      ? "检查弱字、提示、退格和长停顿，决定下一周材料。"
      : "主练五笔编码和真实中文，英文/代码只保留维护量。",
    minutes: targetMinutes,
    blocks,
    checkpoint,
    acceptance: [
      "五笔编码准确率优先，提示过的字词必须无提示重练。",
      "真实中文先稳退格和长停顿，不急着追最高速度。",
      checkpoint ? "整理 Top 弱项和专业词，完成一次同步。" : "英文/代码维护块不抢五笔主训练时间。",
    ],
    syncAction: checkpoint ? "写入同步目录或导出同步包。" : undefined,
  };
}

function buildComfortScheduleDay(
  day: number,
  targetMinutes: number,
  maintenanceMode: TrainingMode,
  checkpoint: boolean,
): TrainingScheduleDay {
  const blocks = buildWubiMainBlocks(targetMinutes, maintenanceMode, true).map((block) =>
    block.mode === maintenanceMode
      ? {
          ...block,
          title: "英文/代码低量维护",
          goal: "只保留手感和复测，不抢中文主线。",
        }
      : block,
  );

  return {
    day,
    kind: "comfort",
    phase: "生产维护",
    title: checkpoint ? "生产输入复盘日" : "中文生产迁移日",
    summary: "英文/代码已进入舒适区，重点用五笔完成真实写作和工作文本。",
    minutes: targetMinutes,
    blocks,
    checkpoint,
    acceptance: [
      "真实中文材料来自笔记、方案、项目报告或专业段落。",
      "退格和长停顿比速度更优先。",
      checkpoint ? "复盘一段真实工作输入，并同步数据。" : "英文/代码只做短维护。",
    ],
    syncAction: checkpoint ? "写入同步目录或导出同步包。" : undefined,
  };
}

function buildWubiMainBlocks(
  targetMinutes: number,
  maintenanceMode: TrainingMode,
  hasWeakTargets: boolean,
): FoundationSprintBlock[] {
  const scale = targetMinutes / 20;
  const rootsMinutes = Math.max(3, Math.round(4 * scale));
  const weakMinutes = Math.max(4, Math.round(5 * scale));
  const realMinutes = Math.max(5, Math.round(6 * scale));
  const termMinutes = Math.max(3, Math.round(3 * scale));
  const maintenanceMinutes = Math.max(
    2,
    targetMinutes - rootsMinutes - weakMinutes - realMinutes - termMinutes,
  );

  return [
    foundationBlock("wubi-roots", "wubi-code", "字根/简码", rootsMinutes, "primary", "建立五笔键位和简码反射。", "无提示完成，错码进入弱项复练。"),
    foundationBlock("weak-review", "wubi-code", hasWeakTargets ? "弱字弱词" : "高频基础字词", weakMinutes, "primary", hasWeakTargets ? "复练最近错误、提示和长停顿字词。" : "建立五笔弱项基线。", "本轮弱项至少无提示正确 1 次。"),
    foundationBlock("real-chinese", "chinese-real", "真实中文", realMinutes, "support", "用 Rime 五笔输入真实段落。", "记录退格、composition 和长停顿位置。"),
    foundationBlock("professional-terms", "wubi-code", "专业词组", termMinutes, "support", "机器人、仿真、视觉伺服等个人专业词。", "稳定词进入材料包，卡顿词保留在弱项队列。"),
    foundationBlock("foundation-maintenance", maintenanceMode, maintenanceMode === "code" ? "代码维护冲 100" : "英文维护冲 100", maintenanceMinutes, "maintenance", "保持工作流底座手感。", "保持 >=80 CPM，长期向 100 CPM 靠近。"),
  ];
}

function foundationBlock(
  id: string,
  mode: TrainingMode,
  title: string,
  minutes: number,
  role: FoundationSprintBlock["role"],
  goal: string,
  acceptance: string,
): FoundationSprintBlock {
  return {
    id,
    mode,
    title,
    minutes,
    role,
    goal,
    acceptance,
  };
}

function buildScheduleHeadline(
  phase: FoundationSprintPhase,
  estimatedFastTrainingDaysToUnlock: number,
  estimatedTrainingDaysToUnlock: number,
  horizonDays: number,
): string {
  if (phase === "comfort") {
    return `未来 ${horizonDays} 个训练日以五笔真实输入和生产迁移为主，英文/代码只做低量维护。`;
  }
  if (phase === "wubi-unlocked") {
    return `当前已经可以进入五笔主线，未来 ${horizonDays} 个训练日以五笔和真实中文为主。`;
  }
  return `预计最快 ${estimatedFastTrainingDaysToUnlock} 个训练日、保守约 ${estimatedTrainingDaysToUnlock} 个训练日补齐英文/代码底座，再切五笔主线。`;
}
