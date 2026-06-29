import type { ExerciseItem, TrainingMode, TrainingSession } from "../types";
import { buildAdaptiveQueue, type AdaptiveQueueEntry } from "./adaptiveQueue";
import { buildTrainingProtocol, type FoundationEvaluationOptions } from "./trainingPlan";

export interface NextPracticeRecommendation {
  mode: TrainingMode;
  entry: AdaptiveQueueEntry;
  source: "protocol" | "current-mode";
  reason: string;
}

export function buildNextPracticeRecommendation(
  items: ExerciseItem[],
  sessions: TrainingSession[],
  currentMode: TrainingMode,
  options: FoundationEvaluationOptions = {},
): NextPracticeRecommendation | null {
  const protocolMode = buildTrainingProtocol(sessions, options).primaryMode;
  const modes = protocolMode === currentMode ? [protocolMode] : [protocolMode, currentMode];

  for (const mode of modes) {
    const entry = buildAdaptiveQueue(items, sessions, mode, { limit: 1, now: options.now })[0];
    if (!entry) continue;
    return {
      mode,
      entry,
      source: mode === protocolMode ? "protocol" : "current-mode",
      reason: mode === protocolMode
        ? "按当前执行协议推荐"
        : "主线模式暂无材料，先延续当前模式",
    };
  }

  return null;
}
