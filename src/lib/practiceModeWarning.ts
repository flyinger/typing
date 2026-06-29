import type { TrainingMode } from "../types";
import type { TrainingProtocol } from "./trainingPlan";

export interface ManualPracticeModeWarning {
  title: string;
  detail: string;
  primaryMode: TrainingMode;
  selectedMode: TrainingMode;
}

const modeLabels: Record<TrainingMode, string> = {
  "wubi-code": "五笔编码",
  "chinese-real": "中文真实输入",
  english: "英文/术语",
  code: "代码",
  vim: "Vim/命令",
};

export function buildManualPracticeModeWarning(
  selectedMode: TrainingMode,
  protocol: TrainingProtocol,
  isQueuedPractice: boolean,
): ManualPracticeModeWarning | null {
  if (isQueuedPractice || selectedMode === protocol.primaryMode) {
    return null;
  }

  const primaryLabel = modeLabels[protocol.primaryMode];
  const selectedLabel = modeLabels[selectedMode];
  const isFoundationProtocol = protocol.title.includes("英文/代码速度底座");
  const isPreWubiManualPractice =
    isFoundationProtocol && (selectedMode === "wubi-code" || selectedMode === "chinese-real");

  return {
    title: isPreWubiManualPractice ? "当前不是五笔主训练阶段" : "当前模式不是今日主线",
    detail: isPreWubiManualPractice
      ? `现在主线是 ${primaryLabel}。${selectedLabel} 可以低量维护，但不要用它替代英文/代码 80 CPM 底座训练。`
      : `当前执行协议主线是 ${primaryLabel}；${selectedLabel} 适合临时加练或维护，今日主训练仍建议回到主线。`,
    primaryMode: protocol.primaryMode,
    selectedMode,
  };
}
