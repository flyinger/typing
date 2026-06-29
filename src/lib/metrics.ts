import type { SessionMetrics, TrainingSession, TrendPoint } from "../types";
import { addLocalDays, localDateKey, startOfLocalDate } from "./date";

const burstInputMinChars = 8;
const burstInputTargetRatio = 0.35;
const longPauseThresholdMs = 1500;

export interface EventCounters {
  backspaces: number;
  pauseCountOver1500Ms: number;
  maxPauseMs: number;
  hintCount: number;
  pasteEventCount?: number;
  compositionEventCount: number;
  wrongKeys: string[];
}

export function diffPositions(target: string, input: string): number[] {
  const maxLength = Math.max(target.length, input.length);
  const positions: number[] = [];
  for (let index = 0; index < maxLength; index += 1) {
    if (target[index] !== input[index]) {
      positions.push(index);
    }
  }
  return positions;
}

export function calculateAccuracy(target: string, input: string): number {
  if (target.length === 0) return 100;
  const errors = diffPositions(target, input).length;
  const score = ((target.length - errors) / target.length) * 100;
  return Math.max(0, Number(score.toFixed(1)));
}

export function chooseBestTargetForInput(targets: string[], input: string): string {
  const normalizedInput = input.trim().toLowerCase();
  const exact = targets.find((target) => target.trim().toLowerCase() === normalizedInput);
  if (exact) return exact;

  return targets.reduce((best, candidate) => {
    const bestErrors = diffPositions(best, input).length;
    const candidateErrors = diffPositions(candidate, input).length;
    return candidateErrors < bestErrors ? candidate : best;
  }, targets[0] ?? "");
}

export function sortSessionsByStartedAtDesc(sessions: TrainingSession[]): TrainingSession[] {
  return [...sessions].sort((left, right) => {
    const startedCompare = right.startedAt.localeCompare(left.startedAt);
    if (startedCompare !== 0) return startedCompare;
    return right.id.localeCompare(left.id);
  });
}

export function getRecentSessions(sessions: TrainingSession[], limit: number): TrainingSession[] {
  return sortSessionsByStartedAtDesc(sessions).slice(0, Math.max(0, Math.floor(limit)));
}

export function detectBurstInput(
  previousValue: string,
  nextValue: string,
  targetText: string,
): { detected: boolean; insertedChars: number; threshold: number } {
  const insertedChars = Math.max(0, nextValue.length - previousValue.length);
  const threshold = Math.max(
    burstInputMinChars,
    Math.ceil(targetText.length * burstInputTargetRatio),
  );

  return {
    detected: insertedChars >= threshold,
    insertedChars,
    threshold,
  };
}

export function classifyBurstInput(
  previousValue: string,
  nextValue: string,
  targetText: string,
  explicitPastePending: boolean,
): { detected: boolean; insertedChars: number; threshold: number; suppressedByExplicitPaste: boolean } {
  const burst = detectBurstInput(previousValue, nextValue, targetText);
  const suppressedByExplicitPaste = explicitPastePending && burst.detected;
  return {
    ...burst,
    detected: burst.detected && !suppressedByExplicitPaste,
    suppressedByExplicitPaste,
  };
}

export function includeFinalPause(
  counters: EventCounters,
  lastInputAtMs: number | null,
  endedAtMs: number,
): { counters: EventCounters; finalPauseMs: number | null } {
  if (lastInputAtMs === null) {
    return { counters, finalPauseMs: null };
  }

  const finalPauseMs = endedAtMs - lastInputAtMs;
  if (finalPauseMs <= longPauseThresholdMs) {
    return { counters, finalPauseMs: null };
  }

  return {
    counters: {
      ...counters,
      pauseCountOver1500Ms: counters.pauseCountOver1500Ms + 1,
      maxPauseMs: Math.max(counters.maxPauseMs, finalPauseMs),
    },
    finalPauseMs,
  };
}

export function calculateSessionMetrics(
  target: string,
  input: string,
  durationMs: number,
  counters: EventCounters,
): SessionMetrics {
  const minutes = Math.max(durationMs / 60000, 1 / 60);
  const charsPerMinute = Number((input.length / minutes).toFixed(1));
  const errorPositions = diffPositions(target, input);
  const accuracy = calculateAccuracy(target, input);
  const backspacePer100Chars = input.length
    ? Number(((counters.backspaces / input.length) * 100).toFixed(1))
    : counters.backspaces > 0
      ? 100
      : 0;

  const weakTargets = Array.from(
    new Set(errorPositions.map((position) => target[position]).filter(Boolean)),
  );

  return {
    charsPerMinute,
    accuracy,
    backspaces: counters.backspaces,
    backspacePer100Chars,
    pauseCountOver1500Ms: counters.pauseCountOver1500Ms,
    maxPauseMs: counters.maxPauseMs,
    correctUnits: Math.max(0, target.length - errorPositions.length),
    totalUnits: target.length,
    hintUsed: counters.hintCount > 0,
    hintCount: counters.hintCount,
    pasteEventCount: counters.pasteEventCount ?? 0,
    compositionEventCount: counters.compositionEventCount,
    wrongKeys: counters.wrongKeys,
    weakTargets,
    errorPositions,
  };
}

export function buildTrendPoints(
  sessions: TrainingSession[],
  days = 30,
  now = new Date(),
): TrendPoint[] {
  const today = startOfLocalDate(now);
  const buckets = new Map<string, TrainingSession[]>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addLocalDays(today, -offset);
    buckets.set(localDateKey(date), []);
  }

  for (const session of sessions) {
    const key = localDateKey(session.startedAt);
    if (buckets.has(key)) {
      buckets.get(key)!.push(session);
    }
  }

  return Array.from(buckets.entries()).map(([date, items]) => {
    const minutes = items.reduce((sum, session) => sum + session.durationMs / 60000, 0);
    const averages = averageMetrics(items);
    return {
      date,
      minutes: Number(minutes.toFixed(1)),
      sessions: items.length,
      charsPerMinute: averages.charsPerMinute,
      accuracy: averages.accuracy,
      backspacePer100Chars: averages.backspacePer100Chars,
    };
  });
}

export function averageMetrics(sessions: TrainingSession[]): {
  charsPerMinute: number;
  accuracy: number;
  backspacePer100Chars: number;
} {
  if (sessions.length === 0) {
    return { charsPerMinute: 0, accuracy: 0, backspacePer100Chars: 0 };
  }

  const totals = sessions.reduce(
    (sum, session) => ({
      charsPerMinute: sum.charsPerMinute + session.metrics.charsPerMinute,
      accuracy: sum.accuracy + session.metrics.accuracy,
      backspacePer100Chars:
        sum.backspacePer100Chars + session.metrics.backspacePer100Chars,
    }),
    { charsPerMinute: 0, accuracy: 0, backspacePer100Chars: 0 },
  );

  return {
    charsPerMinute: Number((totals.charsPerMinute / sessions.length).toFixed(1)),
    accuracy: Number((totals.accuracy / sessions.length).toFixed(1)),
    backspacePer100Chars: Number(
      (totals.backspacePer100Chars / sessions.length).toFixed(1),
    ),
  };
}

export function calculateStreak(sessions: TrainingSession[], now = new Date()): number {
  const activeDays = new Set(sessions.map((session) => localDateKey(session.startedAt)));
  let streak = 0;
  const cursor = startOfLocalDate(now);

  while (activeDays.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export function rankWeakTargets(sessions: TrainingSession[], limit = 20): Array<{
  target: string;
  count: number;
}> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    for (const target of session.metrics.weakTargets) {
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([target, count]) => ({ target, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

export function rankWeakKeys(sessions: TrainingSession[], limit = 20): Array<{
  key: string;
  count: number;
}> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    for (const key of session.metrics.wrongKeys) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}
