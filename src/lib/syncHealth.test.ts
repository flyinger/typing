import { describe, expect, it } from "vitest";
import type {
  AppSettings,
  InputEventLog,
  MaterialPack,
  SessionMetrics,
  TrainingSession,
} from "../types";
import { buildSyncHealthReport } from "./syncHealth";

const settings: AppSettings = {
  id: "main",
  deviceId: "device_mac",
  deviceName: "Mac",
  dailyTargetMinutes: 20,
  syncFolderHint: "TypingLab/",
  theme: "dark",
  lastSyncExportAt: "2026-06-24T00:00:00.000Z",
  lastSyncImportAt: "2026-06-23T00:00:00.000Z",
};

const metrics: SessionMetrics = {
  charsPerMinute: 60,
  accuracy: 98,
  backspaces: 1,
  backspacePer100Chars: 5,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  correctUnits: 10,
  totalUnits: 10,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
  weakTargets: [],
  errorPositions: [],
};

const material: MaterialPack = {
  id: "pack_1",
  name: "基础材料",
  description: "test",
  version: 1,
  source: "builtin",
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
  contentHash: "hash",
  items: [],
};

function session(
  id: string,
  deviceId: string,
  startedAt: string,
  materialId = "pack_1",
): TrainingSession {
  return {
    id,
    deviceId,
    mode: "wubi-code",
    materialId,
    itemId: "item_1",
    targetText: "器械",
    inputText: "kkaw",
    startedAt,
    endedAt: startedAt,
    durationMs: 60000,
    metrics,
  };
}

function event(
  eventId: string,
  sessionId: string,
  deviceId: string,
  sequence: number,
  type: InputEventLog["type"],
): InputEventLog {
  return {
    eventId,
    sessionId,
    deviceId,
    sequence,
    type,
    occurredAt: "2026-06-25T10:00:00.000Z",
    payload: {},
  };
}

describe("buildSyncHealthReport", () => {
  it("summarizes devices, events, and healthy sync state", () => {
    const report = buildSyncHealthReport(
      {
        ...settings,
        lastSyncExportAt: "2026-06-25T11:00:00.000Z",
        lastSyncImportAt: "2026-06-25T07:00:00.000Z",
      },
      [
        session("s1", "device_mac", "2026-06-25T09:00:00.000Z"),
        session("s2", "device_ubuntu", "2026-06-25T08:00:00.000Z"),
      ],
      [
        event("e1", "s1", "device_mac", 1, "session_started"),
        event("e2", "s1", "device_mac", 2, "session_completed"),
        event("e3", "s2", "device_ubuntu", 1, "session_started"),
        event("e4", "s2", "device_ubuntu", 2, "session_completed"),
      ],
      [material],
      new Date("2026-06-25T12:00:00.000Z"),
    );

    expect(report.status).toBe("ok");
    expect(report.nextAction).toMatchObject({
      code: "healthy",
      priority: "none",
    });
    expect(report.actionPlan[0]).toMatchObject({
      id: "sync-healthy",
      status: "done",
    });
    expect(report.summary).toMatchObject({
      sessions: 2,
      events: 4,
      devices: 2,
      minutes: 2,
      daysSinceExport: 0,
      unsyncedSessions: 0,
      unsyncedEvents: 0,
      importAfterExport: false,
      dataFingerprint: {
        algorithm: "fnv1a64-stable-json-v1",
        counts: { sessions: 2, events: 4, materials: 1 },
      },
    });
    expect(report.summary.dataFingerprint.shortValue).toHaveLength(12);
    expect(report.deviceSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deviceId: "device_mac", deviceName: "Mac", sessions: 1 }),
        expect.objectContaining({ deviceId: "device_ubuntu", sessions: 1 }),
      ]),
    );
    expect(report.eventTypeSummaries).toEqual(
      expect.arrayContaining([
        { type: "session_started", count: 2 },
        { type: "session_completed", count: 2 },
      ]),
    );
  });

  it("reports event and material integrity issues", () => {
    const report = buildSyncHealthReport(
      settings,
      [session("s1", "device_mac", "2026-06-25T09:00:00.000Z", "missing_pack")],
      [event("e1", "s1", "device_mac", 2, "session_started")],
      [material],
      new Date("2026-06-25T12:00:00.000Z"),
    );

    expect(report.status).toBe("attention");
    expect(report.nextAction).toMatchObject({
      code: "fix-data",
      priority: "high",
    });
    expect(report.actionPlan.map((step) => step.id)).toEqual([
      "backup-before-fix",
      "inspect-integrity",
      "restore-from-peer",
    ]);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("缺少 session_completed"),
        expect.stringContaining("sequence 不连续"),
        expect.stringContaining("缺失材料包 missing_pack"),
      ]),
    );
    expect(report.recommendation).toContain("先导出同步包备份");
  });

  it("recommends baseline training for empty data", () => {
    const report = buildSyncHealthReport(
      { ...settings, lastSyncExportAt: undefined, lastSyncImportAt: undefined },
      [],
      [],
      [material],
      new Date("2026-06-25T12:00:00.000Z"),
    );

    expect(report.status).toBe("empty");
    expect(report.nextAction).toMatchObject({
      code: "baseline-export",
      priority: "low",
    });
    expect(report.actionPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "train-baseline", status: "now" }),
        expect.objectContaining({ id: "first-export", status: "next" }),
        expect.objectContaining({ id: "import-on-peer", status: "later" }),
      ]),
    );
    expect(report.actionPlan[0].detail).toContain("英文和代码底座样本");
    expect(report.actionPlan[0].detail).toContain("五笔只做一级简码低量验收");
    expect(report.summary).toMatchObject({
      unsyncedSessions: 0,
      unsyncedEvents: 0,
    });
    expect(report.recommendation).toContain("先完成 3 到 5 轮基线训练");
  });

  it("marks new local training after export as pending export", () => {
    const report = buildSyncHealthReport(
      {
        ...settings,
        lastSyncExportAt: "2026-06-25T08:30:00.000Z",
        lastSyncImportAt: "2026-06-25T07:00:00.000Z",
      },
      [session("s1", "device_mac", "2026-06-25T09:00:00.000Z")],
      [
        event("e1", "s1", "device_mac", 1, "session_started"),
        event("e2", "s1", "device_mac", 2, "session_completed"),
      ],
      [material],
      new Date("2026-06-25T12:00:00.000Z"),
    );

    expect(report.status).toBe("attention");
    expect(report.nextAction).toMatchObject({
      code: "export-pending",
      label: "导出新增训练",
      priority: "high",
    });
    expect(report.actionPlan[0]).toMatchObject({
      id: "export-new-training",
      status: "now",
    });
    expect(report.actionPlan[0].detail).toContain("新增 1 个会话、2 条事件");
    expect(report.summary).toMatchObject({
      unsyncedSessions: 1,
      unsyncedEvents: 2,
    });
    expect(report.recommendation).toContain("上次导出后新增 1 个会话、2 条事件");
  });

  it("marks new or edited material packs after export as pending export", () => {
    const importedMaterial: MaterialPack = {
      ...material,
      id: "pack_imported_terms",
      name: "专业词材料",
      source: "manual",
      createdAt: "2026-06-25T09:30:00.000Z",
      updatedAt: "2026-06-25T09:30:00.000Z",
    };
    const report = buildSyncHealthReport(
      {
        ...settings,
        lastSyncExportAt: "2026-06-25T08:30:00.000Z",
        lastSyncImportAt: "2026-06-25T07:00:00.000Z",
      },
      [],
      [
        {
          ...event("material-event-1", "material_create", "device_mac", 1, "material_created"),
          occurredAt: "2026-06-25T09:30:00.000Z",
          payload: {
            materialId: importedMaterial.id,
          },
        },
      ],
      [material, importedMaterial],
      new Date("2026-06-25T12:00:00.000Z"),
    );

    expect(report.status).toBe("attention");
    expect(report.nextAction).toMatchObject({
      code: "export-pending",
      priority: "high",
    });
    expect(report.summary).toMatchObject({
      unsyncedSessions: 0,
      unsyncedEvents: 1,
      unsyncedMaterials: 1,
    });
    expect(report.nextAction.detail).toContain("0 个会话、1 条事件、1 个材料包");
    expect(report.actionPlan[0].detail).toContain("0 个会话、1 条事件、1 个材料包");
  });

  it("asks for a new export after importing newer merged data", () => {
    const report = buildSyncHealthReport(
      {
        ...settings,
        lastSyncExportAt: "2026-06-25T08:00:00.000Z",
        lastSyncImportAt: "2026-06-25T10:00:00.000Z",
      },
      [session("s1", "device_mac", "2026-06-25T07:00:00.000Z")],
      [
        {
          ...event("e1", "s1", "device_mac", 1, "session_started"),
          occurredAt: "2026-06-25T07:00:00.000Z",
        },
        {
          ...event("e2", "s1", "device_mac", 2, "session_completed"),
          occurredAt: "2026-06-25T07:01:00.000Z",
        },
      ],
      [material],
      new Date("2026-06-25T12:00:00.000Z"),
    );

    expect(report.status).toBe("attention");
    expect(report.nextAction).toMatchObject({
      code: "export-after-import",
      priority: "high",
    });
    expect(report.actionPlan.map((step) => step.id)).toEqual([
      "export-merged",
      "peer-read-merged",
      "resume-training",
    ]);
    expect(report.summary).toMatchObject({
      unsyncedSessions: 0,
      unsyncedEvents: 0,
      importAfterExport: true,
    });
    expect(report.recommendation).toContain("最近导入时间晚于上次导出");
  });

  it("asks for a fresh import when multi-device data has not been imported recently", () => {
    const report = buildSyncHealthReport(
      {
        ...settings,
        lastSyncExportAt: "2026-06-25T11:00:00.000Z",
        lastSyncImportAt: "2026-06-10T10:00:00.000Z",
      },
      [
        session("s1", "device_mac", "2026-06-25T09:00:00.000Z"),
        session("s2", "device_ubuntu", "2026-06-25T08:00:00.000Z"),
      ],
      [
        event("e1", "s1", "device_mac", 1, "session_started"),
        event("e2", "s1", "device_mac", 2, "session_completed"),
        event("e3", "s2", "device_ubuntu", 1, "session_started"),
        event("e4", "s2", "device_ubuntu", 2, "session_completed"),
      ],
      [material],
      new Date("2026-06-25T12:00:00.000Z"),
    );

    expect(report.status).toBe("attention");
    expect(report.nextAction).toMatchObject({
      code: "stale-import",
      priority: "medium",
    });
    expect(report.actionPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "import-peer", status: "now" }),
        expect.objectContaining({ id: "export-after-peer-import", status: "later" }),
      ]),
    );
  });
});
