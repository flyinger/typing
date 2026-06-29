import type {
  AppSettings,
  EventType,
  InputEventLog,
  MaterialPack,
  SyncDataFingerprint,
  TrainingSession,
} from "../types";
import { buildSyncDataFingerprint } from "./syncFingerprint";

export interface DeviceTrainingSummary {
  deviceId: string;
  deviceName: string;
  sessions: number;
  events: number;
  minutes: number;
  lastSeenAt?: string;
}

export interface EventTypeSummary {
  type: EventType;
  count: number;
}

export type SyncNextActionCode =
  | "baseline-export"
  | "fix-data"
  | "export-after-import"
  | "export-pending"
  | "stale-export"
  | "stale-import"
  | "healthy";

export interface SyncNextAction {
  code: SyncNextActionCode;
  label: string;
  detail: string;
  priority: "none" | "low" | "medium" | "high";
}

export type SyncActionStepStatus = "now" | "next" | "later" | "done";

export interface SyncActionStep {
  id: string;
  title: string;
  detail: string;
  status: SyncActionStepStatus;
}

export interface SyncHealthReport {
  status: "empty" | "ok" | "attention";
  summary: {
    sessions: number;
    events: number;
    materials: number;
    devices: number;
    minutes: number;
    lastSessionAt?: string;
    lastEventAt?: string;
    dataFingerprint: SyncDataFingerprint;
    daysSinceExport?: number;
    daysSinceImport?: number;
    unsyncedSessions: number;
    unsyncedEvents: number;
    unsyncedMaterials: number;
    importAfterExport: boolean;
  };
  deviceSummaries: DeviceTrainingSummary[];
  eventTypeSummaries: EventTypeSummary[];
  issues: string[];
  nextAction: SyncNextAction;
  actionPlan: SyncActionStep[];
  recommendation: string;
}

export function buildSyncHealthReport(
  settings: AppSettings,
  sessions: TrainingSession[],
  events: InputEventLog[],
  materials: MaterialPack[],
  now = new Date(),
): SyncHealthReport {
  const deviceSummaries = summarizeDevices(settings, sessions, events);
  const eventTypeSummaries = summarizeEventTypes(events);
  const issues = [
    ...findEventStreamIssues(sessions, events),
    ...findMaterialReferenceIssues(sessions, materials),
  ];
  const lastSessionAt = maxIso(sessions.map((session) => session.startedAt));
  const lastEventAt = maxIso(events.map((event) => event.occurredAt));
  const dataFingerprint = buildSyncDataFingerprint(sessions, events, materials);
  const daysSinceExport = daysSince(settings.lastSyncExportAt, now);
  const daysSinceImport = daysSince(settings.lastSyncImportAt, now);
  const unsyncedSessions = countAfter(sessions.map((session) => session.startedAt), settings.lastSyncExportAt);
  const unsyncedEvents = countAfter(events.map((event) => event.occurredAt), settings.lastSyncExportAt);
  const unsyncedMaterials = countAfter(
    materials.map((material) => maxIso([material.createdAt, material.updatedAt]) ?? ""),
    settings.lastSyncExportAt,
  );
  const importAfterExport = Boolean(
    settings.lastSyncImportAt &&
      (!settings.lastSyncExportAt || settings.lastSyncImportAt > settings.lastSyncExportAt),
  );
  const minutes = Number(
    sessions.reduce((sum, session) => sum + session.durationMs / 60000, 0).toFixed(1),
  );
  const status =
    sessions.length === 0 && events.length === 0
      ? "empty"
      : issues.length > 0 ||
          daysSinceExport === undefined ||
          unsyncedSessions > 0 ||
          unsyncedEvents > 0 ||
          unsyncedMaterials > 0 ||
          importAfterExport ||
          daysSinceExport >= 7 ||
          (deviceSummaries.length > 1 && (daysSinceImport === undefined || daysSinceImport >= 7))
        ? "attention"
        : "ok";
  const nextAction = buildNextAction({
    sessions,
    events,
    issues,
    daysSinceExport,
    daysSinceImport,
    unsyncedSessions,
    unsyncedEvents,
    unsyncedMaterials,
    importAfterExport,
    deviceCount: deviceSummaries.length,
  });

  return {
    status,
    summary: {
      sessions: sessions.length,
      events: events.length,
      materials: materials.length,
      devices: deviceSummaries.length,
      minutes,
      lastSessionAt,
      lastEventAt,
      dataFingerprint,
      daysSinceExport,
      daysSinceImport,
      unsyncedSessions,
      unsyncedEvents,
      unsyncedMaterials,
      importAfterExport,
    },
    deviceSummaries,
    eventTypeSummaries,
    issues,
    nextAction,
    actionPlan: buildActionPlan(nextAction, {
      sessions,
      events,
      issues,
      unsyncedSessions,
      unsyncedEvents,
      unsyncedMaterials,
      importAfterExport,
      deviceCount: deviceSummaries.length,
      daysSinceExport,
      daysSinceImport,
    }),
    recommendation: nextAction.detail,
  };
}

function summarizeDevices(
  settings: AppSettings,
  sessions: TrainingSession[],
  events: InputEventLog[],
): DeviceTrainingSummary[] {
  const rows = new Map<string, DeviceTrainingSummary>();

  function rowFor(deviceId: string): DeviceTrainingSummary {
    const existing = rows.get(deviceId);
    if (existing) return existing;
    const row: DeviceTrainingSummary = {
      deviceId,
      deviceName: deviceId === settings.deviceId ? settings.deviceName : shortDeviceId(deviceId),
      sessions: 0,
      events: 0,
      minutes: 0,
    };
    rows.set(deviceId, row);
    return row;
  }

  rowFor(settings.deviceId);
  for (const session of sessions) {
    const row = rowFor(session.deviceId);
    row.sessions += 1;
    row.minutes = Number((row.minutes + session.durationMs / 60000).toFixed(1));
    row.lastSeenAt = maxIso([row.lastSeenAt, session.startedAt]);
  }
  for (const event of events) {
    const row = rowFor(event.deviceId);
    row.events += 1;
    row.lastSeenAt = maxIso([row.lastSeenAt, event.occurredAt]);
  }

  return Array.from(rows.values()).sort((left, right) => {
    const time = (right.lastSeenAt ?? "").localeCompare(left.lastSeenAt ?? "");
    return time === 0 ? right.sessions - left.sessions : time;
  });
}

function summarizeEventTypes(events: InputEventLog[]): EventTypeSummary[] {
  const counts = new Map<EventType, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}

function findEventStreamIssues(
  sessions: TrainingSession[],
  events: InputEventLog[],
): string[] {
  const issues: string[] = [];
  const sessionIds = new Set(sessions.map((session) => session.id));
  const eventIds = new Set<string>();
  const duplicateEventIds = new Set<string>();
  const eventsBySession = new Map<string, InputEventLog[]>();

  for (const event of events) {
    if (eventIds.has(event.eventId)) {
      duplicateEventIds.add(event.eventId);
    }
    eventIds.add(event.eventId);
    if (sessionIds.has(event.sessionId)) {
      const bucket = eventsBySession.get(event.sessionId) ?? [];
      bucket.push(event);
      eventsBySession.set(event.sessionId, bucket);
    } else if (!event.sessionId.startsWith("material_")) {
      issues.push(`事件 ${event.eventId} 引用了不存在的训练会话 ${event.sessionId}。`);
    }
  }

  if (duplicateEventIds.size > 0) {
    issues.push(`发现 ${duplicateEventIds.size} 个重复 eventId。`);
  }

  for (const session of sessions) {
    const sessionEvents = eventsBySession.get(session.id) ?? [];
    if (sessionEvents.length === 0) {
      issues.push(`训练会话 ${session.id} 缺少事件日志。`);
      continue;
    }
    if (!sessionEvents.some((event) => event.type === "session_started")) {
      issues.push(`训练会话 ${session.id} 缺少 session_started 事件。`);
    }
    if (!sessionEvents.some((event) => event.type === "session_completed")) {
      issues.push(`训练会话 ${session.id} 缺少 session_completed 事件。`);
    }
    if (hasSequenceGap(sessionEvents)) {
      issues.push(`训练会话 ${session.id} 的事件 sequence 不连续。`);
    }
  }

  return issues;
}

function findMaterialReferenceIssues(
  sessions: TrainingSession[],
  materials: MaterialPack[],
): string[] {
  const materialIds = new Set(materials.map((material) => material.id));
  const missing = new Set<string>();
  for (const session of sessions) {
    if (session.materialId && !materialIds.has(session.materialId)) {
      missing.add(session.materialId);
    }
  }
  return Array.from(missing).map((materialId) => `训练记录引用了缺失材料包 ${materialId}。`);
}

function hasSequenceGap(events: InputEventLog[]): boolean {
  const sequences = events.map((event) => event.sequence).sort((left, right) => left - right);
  for (const [index, sequence] of sequences.entries()) {
    if (sequence !== index + 1) return true;
  }
  return false;
}

function buildNextAction({
  sessions,
  events,
  issues,
  daysSinceExport,
  daysSinceImport,
  unsyncedSessions,
  unsyncedEvents,
  unsyncedMaterials,
  importAfterExport,
  deviceCount,
}: {
  sessions: TrainingSession[];
  events: InputEventLog[];
  issues: string[];
  daysSinceExport?: number;
  daysSinceImport?: number;
  unsyncedSessions: number;
  unsyncedEvents: number;
  unsyncedMaterials: number;
  importAfterExport: boolean;
  deviceCount: number;
}): SyncNextAction {
  if (sessions.length === 0 && events.length === 0) {
    return {
      code: "baseline-export",
      label: "先建立同步基线",
      detail: "先完成 3 到 5 轮基线训练，再导出第一个同步包。",
      priority: "low",
    };
  }
  if (issues.length > 0) {
    return {
      code: "fix-data",
      label: "先处理数据问题",
      detail: "先导出同步包备份，再检查数据问题；必要时从另一台设备重新导入最近同步包。",
      priority: "high",
    };
  }
  if (daysSinceExport === undefined) {
    return {
      code: "baseline-export",
      label: "导出第一个同步包",
      detail: "建议现在导出第一个同步包，作为跨设备合并的基线。",
      priority: "medium",
    };
  }
  if (importAfterExport) {
    return {
      code: "export-after-import",
      label: "导入后重新导出",
      detail: "最近导入时间晚于上次导出，建议重新导出同步包或写入同步目录，保留合并后的完整数据。",
      priority: "high",
    };
  }
  if (unsyncedSessions > 0 || unsyncedEvents > 0 || unsyncedMaterials > 0) {
    return {
      code: "export-pending",
      label: "导出新增训练",
      detail: `上次导出后新增 ${unsyncedSessions} 个会话、${unsyncedEvents} 条事件、${unsyncedMaterials} 个材料包；训练或材料整理后建议导出同步包或写入同步目录。`,
      priority: "high",
    };
  }
  if (daysSinceExport >= 7) {
    return {
      code: "stale-export",
      label: "刷新同步包",
      detail: "已经 7 天以上未导出同步包，建议训练结束后导出并同步到另一台电脑。",
      priority: "medium",
    };
  }
  if (deviceCount > 1 && (daysSinceImport === undefined || daysSinceImport >= 7)) {
    return {
      code: "stale-import",
      label: "导入另一台设备",
      detail: "已有多设备数据，但最近导入时间较久，建议从另一台电脑导入最新同步包。",
      priority: "medium",
    };
  }
  return {
    code: "healthy",
    label: "同步状态正常",
    detail: "数据状态正常；继续训练，跨设备使用时保持每周至少一次导入/导出。",
    priority: "none",
  };
}

function buildActionPlan(
  nextAction: SyncNextAction,
  context: {
    sessions: TrainingSession[];
    events: InputEventLog[];
    issues: string[];
    unsyncedSessions: number;
    unsyncedEvents: number;
    unsyncedMaterials: number;
    importAfterExport: boolean;
    deviceCount: number;
    daysSinceExport?: number;
    daysSinceImport?: number;
  },
): SyncActionStep[] {
  if (nextAction.code === "fix-data") {
    return [
      {
        id: "backup-before-fix",
        title: "先备份当前数据",
        detail: "导出同步包或同步目录清单，保留当前 IndexedDB 中的事实流。",
        status: "now",
      },
      {
        id: "inspect-integrity",
        title: "检查完整性问题",
        detail: `当前有 ${context.issues.length} 个数据问题；优先处理缺失事件、重复 eventId 或材料引用。`,
        status: "next",
      },
      {
        id: "restore-from-peer",
        title: "必要时从另一台设备恢复",
        detail: "如果本机事实流不完整，从 Mac/Ubuntu 中较新的同步目录或同步包重新导入。",
        status: "later",
      },
    ];
  }

  if (nextAction.code === "baseline-export" && context.sessions.length === 0 && context.events.length === 0) {
    return [
      {
        id: "train-baseline",
        title: "完成第一批基线训练",
        detail: "先完成英文和代码底座样本，五笔只做一级简码低量验收，确保训练台和材料都能正常记录事件。",
        status: "now",
      },
      {
        id: "first-export",
        title: "导出第一份同步基线",
        detail: "训练后写入同步目录，或导出同步包/同步目录清单。",
        status: "next",
      },
      {
        id: "import-on-peer",
        title: "在另一台电脑导入验证",
        detail: "到另一台电脑读取同步目录或导入同步包，确认新增会话和事件可合并。",
        status: "later",
      },
    ];
  }

  if (nextAction.code === "baseline-export") {
    return [
      {
        id: "export-baseline",
        title: "导出当前基线",
        detail: `当前已有 ${context.sessions.length} 个会话和 ${context.events.length} 条事件，先建立跨设备同步起点。`,
        status: "now",
      },
      {
        id: "peer-import-baseline",
        title: "在另一台设备导入",
        detail: "确认 Mac 和 Ubuntu 能看到同一批训练记录，再继续两边训练。",
        status: "next",
      },
      {
        id: "weekly-sync-loop",
        title: "进入每周同步循环",
        detail: "之后按训练结束导出、另一台导入、合并后再导出的节奏维护。",
        status: "later",
      },
    ];
  }

  if (nextAction.code === "export-after-import") {
    return [
      {
        id: "export-merged",
        title: "导出合并后的完整数据",
        detail: "刚导入过另一台设备的数据，本机现在应重新写入同步目录或导出同步包。",
        status: "now",
      },
      {
        id: "peer-read-merged",
        title: "另一台设备读取合并结果",
        detail: "让另一台电脑读取这份合并后的事实流，避免两边继续分叉。",
        status: "next",
      },
      {
        id: "resume-training",
        title: "继续训练",
        detail: "两边都确认合并后，再继续当天训练。",
        status: "later",
      },
    ];
  }

  if (nextAction.code === "export-pending") {
    return [
      {
        id: "export-new-training",
        title: "导出新增训练",
        detail: `上次导出后新增 ${context.unsyncedSessions} 个会话、${context.unsyncedEvents} 条事件、${context.unsyncedMaterials} 个材料包；优先写入同步目录。`,
        status: "now",
      },
      {
        id: "wait-file-sync",
        title: "等待文件同步完成",
        detail: "等 Syncthing、iCloud、Dropbox 或公司网盘把 TypingLab/ 同步到另一台电脑。",
        status: "next",
      },
      {
        id: "peer-import-new-training",
        title: "另一台电脑读取并确认合并",
        detail: "在另一台设备读取同步目录或导入同步包，预览新增/跳过数量后确认。",
        status: "later",
      },
    ];
  }

  if (nextAction.code === "stale-export") {
    return [
      {
        id: "refresh-export",
        title: "刷新同步目录",
        detail: `上次导出已超过 ${context.daysSinceExport ?? 7} 天，先写入同步目录或导出同步包。`,
        status: "now",
      },
      {
        id: "peer-refresh-import",
        title: "另一台设备刷新导入",
        detail: "把这周数据带到另一台电脑，避免周复盘只看到单机样本。",
        status: "next",
      },
      {
        id: "verify-stats",
        title: "复核统计一致性",
        detail: "两台电脑的会话数、事件数和设备分布应基本一致。",
        status: "later",
      },
    ];
  }

  if (nextAction.code === "stale-import") {
    return [
      {
        id: "import-peer",
        title: "导入另一台设备数据",
        detail: `已有 ${context.deviceCount} 台设备数据，最近导入偏旧；先读取另一台的同步目录或同步包。`,
        status: "now",
      },
      {
        id: "confirm-merge",
        title: "确认合并预览",
        detail: "检查新增/跳过数量和确认后健康状态，没有异常再合并。",
        status: "next",
      },
      {
        id: "export-after-peer-import",
        title: "合并后重新导出",
        detail: "导入后立即写入同步目录，让另一台电脑也拿到合并后的完整数据。",
        status: "later",
      },
    ];
  }

  return [
    {
      id: "sync-healthy",
      title: "同步状态正常",
      detail: "当前没有待导出或待导入动作，可以继续训练。",
      status: "done",
    },
    {
      id: "after-next-session",
      title: "下一次训练后导出",
      detail: "完成训练后如果出现待导出会话，优先写入同步目录。",
      status: "later",
    },
    {
      id: "weekly-peer-check",
      title: "每周做一次另一台导入",
      detail: "即使主要在一台电脑训练，也每周让另一台电脑读一次同步目录确认可合并。",
      status: "later",
    },
  ];
}

function countAfter(values: string[], after: string | undefined): number {
  if (!after) return values.length;
  return values.filter((value) => value > after).length;
}

function daysSince(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function maxIso(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}

function shortDeviceId(deviceId: string): string {
  return deviceId.length > 16 ? `${deviceId.slice(0, 10)}...${deviceId.slice(-4)}` : deviceId;
}
