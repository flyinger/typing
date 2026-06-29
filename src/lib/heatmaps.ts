import type { InputEventLog, MaterialPack, TrainingSession } from "../types";
import { addLocalDays, localDateKey, startOfLocalDate } from "./date";
import { averageMetrics } from "./metrics";

export interface ActivityHeatmapDay {
  date: string;
  sessions: number;
  minutes: number;
  charsPerMinute: number;
  accuracy: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatmapKeyCell {
  key: string;
  label: string;
  detail: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface TextHotspot {
  id: string;
  label: string;
  context: string;
  count: number;
  detail: string;
}

const keyboardRows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;

const wubiRootLabels: Record<string, string> = {
  a: "工 戈 草头",
  b: "子 耳 了 也",
  c: "又 巴 马",
  d: "大 犬 三 石",
  e: "月 彡 乃 用",
  f: "土 士 二 干",
  g: "王 青头 五 一",
  h: "目 具 上 止",
  i: "水 小 兴",
  j: "日 早 虫",
  k: "口 川",
  l: "田 甲 车 力",
  m: "山 由 贝 几",
  n: "已 巳 尸 心",
  o: "火 业 米",
  p: "之 宝盖 礻 衤",
  q: "金 勹 儿 夕",
  r: "白 手 斤",
  s: "木 丁 西",
  t: "禾 竹 夂 彳",
  u: "立 辛 门",
  v: "女 刀 九 臼",
  w: "人 八",
  x: "弓 匕 幺",
  y: "言 文 方 广",
};

export function buildTrainingCalendarHeatmap(
  sessions: TrainingSession[],
  days = 56,
  now = new Date(),
): ActivityHeatmapDay[] {
  const today = startOfLocalDate(now);
  const buckets = new Map<string, TrainingSession[]>();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    buckets.set(localDateKey(addLocalDays(today, -offset)), []);
  }

  for (const session of sessions) {
    const key = localDateKey(session.startedAt);
    buckets.get(key)?.push(session);
  }

  return Array.from(buckets.entries()).map(([date, items]) => {
    const minutes = Number(
      items.reduce((sum, session) => sum + session.durationMs / 60000, 0).toFixed(1),
    );
    const averages = averageMetrics(items);
    return {
      date,
      sessions: items.length,
      minutes,
      charsPerMinute: averages.charsPerMinute,
      accuracy: averages.accuracy,
      level: activityLevel(minutes, items.length),
    };
  });
}

export function buildKeyboardHeatmap(sessions: TrainingSession[]): HeatmapKeyCell[][] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    for (const key of session.metrics.wrongKeys) {
      const normalized = normalizeKey(key);
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return buildKeyboardRows(counts, (key) => key.toUpperCase());
}

export function buildWubiRootHeatmap(
  sessions: TrainingSession[],
  materials: MaterialPack[],
): HeatmapKeyCell[][] {
  const itemsById = new Map(
    materials.flatMap((material) => material.items.map((item) => [item.id, item] as const)),
  );
  const counts = new Map<string, number>();

  for (const session of sessions) {
    if (session.mode !== "wubi-code") continue;
    const item = itemsById.get(session.itemId);
    const pressure =
      session.metrics.hintCount +
      session.metrics.wrongKeys.length +
      session.metrics.errorPositions.length +
      (session.metrics.accuracy < 100 ? 1 : 0);
    if (pressure <= 0) continue;

    const expectedCode = item?.expectedCodes?.[0] ?? session.inputText;
    const rootKeys = new Set(
      expectedCode
        .toLowerCase()
        .split("")
        .map(normalizeKey)
        .filter((key): key is string => Boolean(key)),
    );

    for (const key of rootKeys) {
      counts.set(key, (counts.get(key) ?? 0) + Math.max(1, pressure));
    }
  }

  return buildKeyboardRows(counts, (key) => wubiRootLabels[key] ?? key.toUpperCase());
}

export function buildErrorPositionHotspots(
  sessions: TrainingSession[],
  limit = 12,
): TextHotspot[] {
  const counts = new Map<string, TextHotspot>();

  for (const session of sessions) {
    for (const position of session.metrics.errorPositions) {
      const context = formatTextContext(session.targetText, position);
      const label = session.targetText[position] ?? "结尾";
      const id = `${session.mode}:${label}:${context}`;
      const existing = counts.get(id);
      counts.set(id, {
        id,
        label,
        context,
        count: (existing?.count ?? 0) + 1,
        detail: `${session.mode} · 位置 ${position + 1}`,
      });
    }
  }

  return sortHotspots(counts, limit);
}

export function buildPausePositionHotspots(
  sessions: TrainingSession[],
  events: InputEventLog[],
  limit = 12,
): TextHotspot[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const counts = new Map<string, TextHotspot>();

  for (const event of events) {
    if (event.type !== "long_pause") continue;
    const session = sessionsById.get(event.sessionId);
    if (!session) continue;
    const position = typeof event.payload.position === "number" ? event.payload.position : 0;
    const pauseMs = typeof event.payload.pauseMs === "number" ? event.payload.pauseMs : 0;
    const context = formatTextContext(session.targetText, position);
    const label = session.targetText[position] ?? "结尾";
    const id = `${session.mode}:${label}:${context}`;
    const existing = counts.get(id);
    counts.set(id, {
      id,
      label,
      context,
      count: (existing?.count ?? 0) + 1,
      detail: `${session.mode} · 最长停顿 ${Math.round(Math.max(pauseMs, parsePauseMs(existing?.detail)))}ms`,
    });
  }

  return sortHotspots(counts, limit);
}

function buildKeyboardRows(
  counts: Map<string, number>,
  detailForKey: (key: string) => string,
): HeatmapKeyCell[][] {
  const max = Math.max(1, ...Array.from(counts.values()));
  return keyboardRows.map((row) =>
    row.split("").map((key) => {
      const count = counts.get(key) ?? 0;
      return {
        key,
        label: key.toUpperCase(),
        detail: detailForKey(key),
        count,
        level: heatLevel(count, max),
      };
    }),
  );
}

function activityLevel(minutes: number, sessions: number): ActivityHeatmapDay["level"] {
  if (sessions === 0 || minutes <= 0) return 0;
  if (minutes < 5) return 1;
  if (minutes < 15) return 2;
  if (minutes < 30) return 3;
  return 4;
}

function heatLevel(count: number, max: number): HeatmapKeyCell["level"] {
  if (count <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function normalizeKey(key: string): string | null {
  const normalized = key.trim().toLowerCase();
  return /^[a-z]$/.test(normalized) ? normalized : null;
}

function formatTextContext(text: string, position: number): string {
  const safePosition = Math.max(0, Math.min(position, Math.max(0, text.length - 1)));
  const start = Math.max(0, safePosition - 5);
  const end = Math.min(text.length, safePosition + 6);
  const left = text.slice(start, safePosition);
  const center = text[safePosition] ?? "";
  const right = text.slice(safePosition + 1, end);
  return `${start > 0 ? "..." : ""}${left}[${center || "末"}]${right}${end < text.length ? "..." : ""}`;
}

function sortHotspots(counts: Map<string, TextHotspot>, limit: number): TextHotspot[] {
  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.context.localeCompare(right.context))
    .slice(0, limit);
}

function parsePauseMs(detail: string | undefined): number {
  if (!detail) return 0;
  const matched = detail.match(/(\d+)ms/);
  return matched ? Number(matched[1]) : 0;
}
