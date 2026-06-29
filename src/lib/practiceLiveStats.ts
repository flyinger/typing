import type { ExerciseItem } from "../types";
import {
  calculateSessionMetrics,
  chooseBestTargetForInput,
  type EventCounters,
} from "./metrics";

export interface PracticeLiveStats {
  expected: string;
  typedUnits: number;
  totalUnits: number;
  progressPercent: number;
  charsPerMinute: number;
  accuracy: number;
  backspaces: number;
  backspacePer100Chars: number;
  elapsedSeconds: number;
  status: "idle" | "typing" | "complete";
}

export function getPracticeExpectedTargets(item: ExerciseItem): string[] {
  if (item.mode === "wubi-code" && item.expectedCodes?.length) {
    return item.expectedCodes;
  }
  return [item.targetText];
}

export function normalizePracticeInput(item: ExerciseItem, inputText: string): string {
  if (item.mode === "code") {
    return inputText.trimEnd();
  }
  return inputText.trim();
}

export function isPracticeInputComplete(item: ExerciseItem, inputText: string): boolean {
  const normalizedInput = normalizePracticeInput(item, inputText);
  if (normalizedInput.length === 0) return false;

  const expectedTargets = getPracticeExpectedTargets(item);
  if (item.mode === "wubi-code") {
    return expectedTargets.some(
      (target) => target.trim().toLowerCase() === normalizedInput.toLowerCase(),
    );
  }

  return expectedTargets.some((target) => target.trimEnd() === normalizedInput);
}

export function buildPracticeLiveStats({
  item,
  inputText,
  elapsedMs,
  counters,
}: {
  item: ExerciseItem;
  inputText: string;
  elapsedMs: number;
  counters: EventCounters;
}): PracticeLiveStats {
  const normalizedInput = normalizePracticeInput(item, inputText);
  const expectedTargets = getPracticeExpectedTargets(item);
  const expected = chooseBestTargetForInput(expectedTargets, normalizedInput);
  const metrics = calculateSessionMetrics(expected, normalizedInput, elapsedMs, counters);
  const totalUnits = expected.length;
  const typedUnits = normalizedInput.length;
  const progressPercent =
    totalUnits > 0
      ? Math.min(100, Number(((typedUnits / totalUnits) * 100).toFixed(0)))
      : 0;
  const status = isPracticeInputComplete(item, inputText)
    ? "complete"
    : typedUnits > 0
      ? "typing"
      : "idle";

  return {
    expected,
    typedUnits,
    totalUnits,
    progressPercent,
    charsPerMinute: typedUnits > 0 ? metrics.charsPerMinute : 0,
    accuracy: typedUnits > 0 ? metrics.accuracy : 100,
    backspaces: metrics.backspaces,
    backspacePer100Chars: metrics.backspacePer100Chars,
    elapsedSeconds: Math.max(0, Math.floor(elapsedMs / 1000)),
    status,
  };
}
