import type { ExerciseItem, TrainingMode } from "../types";

export interface FoundationMaterialModeReadiness {
  mode: "english" | "code";
  totalItems: number;
  effectiveItems: number;
  comfortItems: number;
  targetItems: number;
  missingEffectiveItems: number;
  minEffectiveUnits: number;
  minComfortUnits: number;
  status: "ready" | "attention" | "empty";
  headline: string;
  detail: string;
}

export interface FoundationMaterialReadiness {
  minDurationSeconds: number;
  unlockCpm: number;
  comfortCpm: number;
  modes: FoundationMaterialModeReadiness[];
  ready: boolean;
}

const foundationMaterialTargets = {
  minDurationSeconds: 12,
  unlockCpm: 80,
  comfortCpm: 100,
  targetItemsPerMode: 10,
};

export function buildFoundationMaterialReadiness(
  items: ExerciseItem[],
): FoundationMaterialReadiness {
  const minEffectiveUnits = minUnitsForCpm(
    foundationMaterialTargets.unlockCpm,
    foundationMaterialTargets.minDurationSeconds,
  );
  const minComfortUnits = minUnitsForCpm(
    foundationMaterialTargets.comfortCpm,
    foundationMaterialTargets.minDurationSeconds,
  );
  const modes: FoundationMaterialModeReadiness[] = (["english", "code"] as const).map((mode) =>
    buildModeReadiness(items, mode, minEffectiveUnits, minComfortUnits),
  );

  return {
    minDurationSeconds: foundationMaterialTargets.minDurationSeconds,
    unlockCpm: foundationMaterialTargets.unlockCpm,
    comfortCpm: foundationMaterialTargets.comfortCpm,
    modes,
    ready: modes.every((mode) => mode.status === "ready"),
  };
}

function buildModeReadiness(
  items: ExerciseItem[],
  mode: "english" | "code",
  minEffectiveUnits: number,
  minComfortUnits: number,
): FoundationMaterialModeReadiness {
  const modeItems = items.filter((item) => item.mode === mode);
  const effectiveItems = modeItems.filter((item) => countUnits(item, mode) >= minEffectiveUnits).length;
  const comfortItems = modeItems.filter((item) => countUnits(item, mode) >= minComfortUnits).length;
  const targetItems = foundationMaterialTargets.targetItemsPerMode;
  const missingEffectiveItems = Math.max(0, targetItems - effectiveItems);
  const status: FoundationMaterialModeReadiness["status"] =
    effectiveItems === 0 ? "empty" : missingEffectiveItems > 0 ? "attention" : "ready";

  return {
    mode,
    totalItems: modeItems.length,
    effectiveItems,
    comfortItems,
    targetItems,
    missingEffectiveItems,
    minEffectiveUnits,
    minComfortUnits,
    status,
    headline: buildHeadline(mode, status, effectiveItems, targetItems),
    detail: buildDetail(mode, status, missingEffectiveItems, minEffectiveUnits, minComfortUnits),
  };
}

function countUnits(item: ExerciseItem, mode: TrainingMode): number {
  if (mode === "code") return item.targetText.length;
  return item.targetText.trim().length;
}

function minUnitsForCpm(cpm: number, seconds: number): number {
  return Math.ceil((cpm * seconds) / 60);
}

function buildHeadline(
  mode: "english" | "code",
  status: FoundationMaterialModeReadiness["status"],
  effectiveItems: number,
  targetItems: number,
): string {
  const label = mode === "english" ? "英文" : "代码";
  if (status === "ready") {
    return `${label}底座材料可用`;
  }
  if (status === "empty") {
    return `缺少${label}底座材料`;
  }
  return `${label}底座材料不足：${effectiveItems}/${targetItems}`;
}

function buildDetail(
  mode: "english" | "code",
  status: FoundationMaterialModeReadiness["status"],
  missingEffectiveItems: number,
  minEffectiveUnits: number,
  minComfortUnits: number,
): string {
  const label = mode === "english" ? "英文技术短句" : "代码/符号片段";
  const baseline = `${label}至少 ${minEffectiveUnits} 个输入单位才能在 80 CPM 下接近 12 秒；100 CPM 舒适线建议 >= ${minComfortUnits} 个单位。`;
  if (status === "ready") {
    return baseline;
  }
  return `${baseline} 还需要补充 ${missingEffectiveItems} 条可计入底座的材料。`;
}
