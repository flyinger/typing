import type { ExerciseItem, TrainingMode, TrainingSession } from "../types";

export interface AdaptiveQueueEntry {
  item: ExerciseItem;
  score: number;
  reasons: string[];
  practiceCount: number;
  lastPracticedAt?: string;
}

export interface AdaptiveQueueOptions {
  limit?: number;
  now?: Date;
}

const dayMs = 24 * 60 * 60 * 1000;

export function buildAdaptiveQueue(
  items: ExerciseItem[],
  sessions: TrainingSession[],
  mode: TrainingMode,
  options: AdaptiveQueueOptions = {},
): AdaptiveQueueEntry[] {
  const now = options.now ?? new Date();
  const candidates = items.filter((item) => item.mode === mode);
  const scored = candidates.map((item) => scoreItem(item, sessions, now));

  return scored
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (!left.lastPracticedAt && right.lastPracticedAt) return -1;
      if (left.lastPracticedAt && !right.lastPracticedAt) return 1;
      if (left.item.difficulty !== right.item.difficulty) {
        return left.item.difficulty - right.item.difficulty;
      }
      return left.item.targetText.localeCompare(right.item.targetText, "zh-Hans-CN");
    })
    .slice(0, options.limit ?? scored.length);
}

function scoreItem(
  item: ExerciseItem,
  sessions: TrainingSession[],
  now: Date,
): AdaptiveQueueEntry {
  const relatedSessions = sessions
    .filter(
      (session) =>
        session.mode === item.mode &&
        (session.itemId === item.id || session.targetText === item.targetText),
    )
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));

  if (relatedSessions.length === 0) {
    return {
      item,
      score: Number((3.4 - item.difficulty * 0.12).toFixed(3)),
      reasons: ["新材料"],
      practiceCount: 0,
    };
  }

  const recent = relatedSessions.slice(0, 5);
  const latest = relatedSessions[0];
  const daysSinceLastPractice = Math.max(
    0,
    (now.getTime() - new Date(latest.startedAt).getTime()) / dayMs,
  );
  const mistakeSessions = recent.filter(isMistakeSession);
  const accuracyDeficit =
    recent.reduce((sum, session) => sum + Math.max(0, 100 - session.metrics.accuracy), 0) /
    recent.length;
  const hintPressure =
    recent.reduce((sum, session) => sum + session.metrics.hintCount, 0) / recent.length;
  const backspacePressure =
    recent.reduce((sum, session) => sum + session.metrics.backspacePer100Chars, 0) /
    recent.length;
  const pausePressure =
    recent.reduce((sum, session) => sum + session.metrics.pauseCountOver1500Ms, 0) /
    recent.length;

  let score = 1 + item.difficulty * 0.18;
  const reasons: string[] = [];

  if (accuracyDeficit > 0) {
    score += Math.min(4, accuracyDeficit / 8);
    reasons.push("准确率不足");
  }
  if (hintPressure > 0) {
    score += Math.min(3, hintPressure * 1.2);
    reasons.push("提示依赖");
  }
  if (backspacePressure > 10) {
    score += Math.min(2.5, backspacePressure / 18);
    reasons.push("退格偏高");
  }
  if (pausePressure > 0) {
    score += Math.min(2.5, pausePressure * 0.7);
    reasons.push("停顿偏多");
  }
  if (mistakeSessions.length >= 2) {
    score += mistakeSessions.length * 1.1;
    reasons.push("近期重复错误");
  }

  if (daysSinceLastPractice >= 1) {
    score += Math.min(2.4, Math.log2(daysSinceLastPractice + 1));
    reasons.push("间隔复习");
  } else if (mistakeSessions.length === 0) {
    score -= daysSinceLastPractice < 0.05 ? 2.2 : 1.2;
    reasons.push("刚刚练过");
  }

  return {
    item,
    score: Number(Math.max(0.1, score).toFixed(3)),
    reasons: reasons.length ? reasons : ["保持手感"],
    practiceCount: relatedSessions.length,
    lastPracticedAt: latest.startedAt,
  };
}

function isMistakeSession(session: TrainingSession): boolean {
  return (
    session.metrics.accuracy < 95 ||
    session.metrics.hintCount > 0 ||
    session.metrics.backspacePer100Chars > 15 ||
    session.metrics.pauseCountOver1500Ms > 1 ||
    session.metrics.weakTargets.length > 0
  );
}
