import { describe, expect, it } from "vitest";
import type {
  InputEventLog,
  MaterialPack,
  SessionMetrics,
  TrainingSession,
} from "../types";
import {
  createSyncFolderExport,
  encodeSyncFolderExport,
  parseSyncFolderExport,
  parseSyncFolderFiles,
  type SyncFolderExport,
} from "./syncFolder";

const metrics: SessionMetrics = {
  charsPerMinute: 90,
  accuracy: 99,
  backspaces: 1,
  backspacePer100Chars: 2,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  correctUnits: 12,
  totalUnits: 12,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
  weakTargets: [],
  errorPositions: [],
};

const session: TrainingSession = {
  id: "session_1",
  deviceId: "device/mac",
  mode: "english",
  materialId: "pack_1",
  itemId: "item_1",
  targetText: "offline first",
  inputText: "offline first",
  startedAt: "2026-06-26T08:00:00.000Z",
  endedAt: "2026-06-26T08:00:08.000Z",
  durationMs: 8000,
  metrics,
};

const events: InputEventLog[] = [
  {
    eventId: "event_1",
    sessionId: "session_1",
    deviceId: "device/mac",
    type: "session_started",
    occurredAt: "2026-06-26T08:00:00.000Z",
    sequence: 1,
    payload: {},
  },
  {
    eventId: "event_2",
    sessionId: "session_1",
    deviceId: "device/mac",
    type: "session_completed",
    occurredAt: "2026-06-26T08:00:08.000Z",
    sequence: 2,
    payload: {},
  },
];

const material: MaterialPack = {
  id: "pack_1",
  name: "英文材料",
  description: "English baseline",
  version: 1,
  source: "test",
  createdAt: "2026-06-26T00:00:00.000Z",
  updatedAt: "2026-06-26T00:00:00.000Z",
  contentHash: "abcdef1234567890",
  items: [],
};

function overlaySyncFolderFiles(
  ...folderExports: SyncFolderExport[]
): Array<{ path: string; content: string }> {
  const byPath = new Map<string, { path: string; content: string }>();
  for (const folderExport of folderExports) {
    for (const file of folderExport.files) {
      byPath.set(file.path, { path: file.path, content: file.content });
    }
  }
  return Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path));
}

describe("sync folder export", () => {
  it("creates the product sync folder file layout", () => {
    const folder = createSyncFolderExport(
      "device/mac",
      [session],
      events,
      [material],
      "2026-06-26T09:00:00.000Z",
    );
    const paths = folder.files.map((file) => file.path);
    const manifestFromContent = JSON.parse(folder.files[0].content) as typeof folder.manifest;

    expect(paths).toEqual([
      "TypingLab/manifest.json",
      "TypingLab/sessions/2026-06-26-device_mac.jsonl",
      "TypingLab/materials/pack_1-abcdef1234.json",
      "TypingLab/snapshots/2026-06-26-device_mac.json",
      "TypingLab/exports/sessions-2026-06-26.csv",
    ]);
    expect(folder.manifest.counts).toMatchObject({
      sessions: 1,
      events: 2,
      materials: 1,
      files: 5,
    });
    expect(folder.manifest.dataFingerprint).toMatchObject({
      algorithm: "fnv1a64-stable-json-v1",
      counts: { sessions: 1, events: 2, materials: 1 },
    });
    expect(folder.files.find((file) => file.path.includes("/snapshots/"))?.content).toContain(
      "\"dataFingerprint\"",
    );
    expect(manifestFromContent.files[0].bytes).toBe(new TextEncoder().encode(folder.files[0].content).length);
    expect(encodeSyncFolderExport(folder)).toContain("TypingLab/sessions/2026-06-26-device_mac.jsonl");
  });

  it("buckets session files by local calendar day", () => {
    const localMorningSession = {
      ...session,
      startedAt: new Date(2026, 5, 26, 0, 30).toISOString(),
      endedAt: new Date(2026, 5, 26, 0, 31).toISOString(),
    };
    const folder = createSyncFolderExport(
      "device/mac",
      [localMorningSession],
      [],
      [material],
      new Date(2026, 5, 26, 9, 0).toISOString(),
    );

    expect(folder.files.map((file) => file.path)).toContain("TypingLab/sessions/2026-06-26-device_mac.jsonl");
    expect(folder.files.map((file) => file.path)).toContain("TypingLab/snapshots/2026-06-26-device_mac.json");
    expect(folder.files.map((file) => file.path)).toContain("TypingLab/exports/sessions-2026-06-26.csv");
  });

  it("parses sync folder files back into a sync package", () => {
    const folder = createSyncFolderExport(
      "device/mac",
      [session],
      events,
      [material],
      "2026-06-26T09:00:00.000Z",
    );

    const syncPackage = parseSyncFolderFiles(folder.files);

    expect(syncPackage).toMatchObject({
      schemaVersion: 1,
      exportedAt: "2026-06-26T09:00:00.000Z",
      deviceId: "device/mac",
    });
    expect(syncPackage.sessions).toEqual([session]);
    expect(syncPackage.events).toEqual(events);
    expect(syncPackage.materials).toEqual([material]);
  });

  it("parses an encoded sync folder manifest export", () => {
    const folder = createSyncFolderExport(
      "device/mac",
      [session],
      events,
      [material],
      "2026-06-26T09:00:00.000Z",
    );

    const syncPackage = parseSyncFolderExport(encodeSyncFolderExport(folder));

    expect(syncPackage.sessions).toEqual([session]);
    expect(syncPackage.events).toEqual(events);
    expect(syncPackage.materials).toEqual([material]);
  });

  it("aggregates complete extra device session files beyond the latest manifest", () => {
    const ubuntuSession: TrainingSession = {
      ...session,
      id: "session_ubuntu",
      deviceId: "device/ubuntu",
      mode: "code",
      itemId: "item_ubuntu",
      targetText: "const targetCpm = 80;",
      inputText: "const targetCpm = 80;",
      startedAt: "2026-06-26T08:10:00.000Z",
      endedAt: "2026-06-26T08:10:12.000Z",
      durationMs: 12000,
    };
    const ubuntuEvents: InputEventLog[] = [
      {
        eventId: "ubuntu_event_1",
        sessionId: "session_ubuntu",
        deviceId: "device/ubuntu",
        type: "session_started",
        occurredAt: "2026-06-26T08:10:00.000Z",
        sequence: 1,
        payload: {},
      },
      {
        eventId: "ubuntu_event_2",
        sessionId: "session_ubuntu",
        deviceId: "device/ubuntu",
        type: "session_completed",
        occurredAt: "2026-06-26T08:10:12.000Z",
        sequence: 2,
        payload: {},
      },
    ];
    const macFolder = createSyncFolderExport(
      "device/mac",
      [session],
      events,
      [material],
      "2026-06-26T09:00:00.000Z",
    );
    const ubuntuFolder = createSyncFolderExport(
      "device/ubuntu",
      [ubuntuSession],
      ubuntuEvents,
      [material],
      "2026-06-26T10:00:00.000Z",
    );

    const syncPackage = parseSyncFolderFiles(overlaySyncFolderFiles(macFolder, ubuntuFolder));

    expect(syncPackage.sessions.map((entry) => entry.id).sort()).toEqual([
      "session_1",
      "session_ubuntu",
    ]);
    expect(syncPackage.events.map((entry) => entry.eventId).sort()).toEqual([
      "event_1",
      "event_2",
      "ubuntu_event_1",
      "ubuntu_event_2",
    ]);
    expect(syncPackage.materials).toEqual([material]);
    expect(syncPackage.dataFingerprint).toMatchObject({
      counts: {
        sessions: 2,
        events: 4,
        materials: 1,
      },
    });
    expect(syncPackage.dataFingerprint?.value).not.toBe(ubuntuFolder.manifest.dataFingerprint?.value);
  });

  it("keeps same-id material variants from independent devices", () => {
    const macMaterial: MaterialPack = {
      ...material,
      id: "shared_pack",
      name: "自定义材料",
      description: "mac version",
      contentHash: "macabcdef123456",
    };
    const ubuntuMaterial: MaterialPack = {
      ...macMaterial,
      description: "ubuntu version",
      contentHash: "ubuntuabcdef123456",
    };
    const macFolder = createSyncFolderExport(
      "device/mac",
      [],
      [],
      [macMaterial],
      "2026-06-26T09:00:00.000Z",
    );
    const ubuntuFolder = createSyncFolderExport(
      "device/ubuntu",
      [],
      [],
      [ubuntuMaterial],
      "2026-06-26T10:00:00.000Z",
    );

    const syncPackage = parseSyncFolderFiles(overlaySyncFolderFiles(macFolder, ubuntuFolder));

    expect(syncPackage.materials.map((entry) => entry.contentHash).sort()).toEqual([
      "macabcdef123456",
      "ubuntuabcdef123456",
    ]);
    expect(syncPackage.materials.every((entry) => entry.id === "shared_pack")).toBe(true);
    expect(syncPackage.dataFingerprint).toMatchObject({
      counts: {
        sessions: 0,
        events: 0,
        materials: 2,
      },
    });
  });

  it("rejects a partially synced folder when manifest files are missing", () => {
    const folder = createSyncFolderExport(
      "device/mac",
      [session],
      events,
      [material],
      "2026-06-26T09:00:00.000Z",
    );
    const files = folder.files.filter((file) => !file.path.includes("/sessions/"));

    expect(() => parseSyncFolderFiles(files)).toThrow("同步目录尚未同步完成");
    expect(() => parseSyncFolderFiles(files)).toThrow("TypingLab/sessions/2026-06-26-device_mac.jsonl");
  });

  it("rejects a partially synced folder when manifest byte sizes do not match", () => {
    const folder = createSyncFolderExport(
      "device/mac",
      [session],
      events,
      [material],
      "2026-06-26T09:00:00.000Z",
    );
    const files = folder.files.map((file) =>
      file.path.includes("/exports/") ? { ...file, content: `${file.content}\npartial` } : file,
    );

    expect(() => parseSyncFolderFiles(files)).toThrow("同步目录文件内容不完整");
    expect(() => parseSyncFolderFiles(files)).toThrow("TypingLab/exports/sessions-2026-06-26.csv");
  });

  it("rejects a sync folder when file bytes match but facts do not match the manifest fingerprint", () => {
    const folder = createSyncFolderExport(
      "device/mac",
      [session],
      events,
      [material],
      "2026-06-26T09:00:00.000Z",
    );
    const files = folder.files.map((file) =>
      file.path.includes("/sessions/")
        ? { ...file, content: file.content.replaceAll("offline first", "offline-first") }
        : file,
    );

    expect(() => parseSyncFolderFiles(files)).toThrow("事实流摘要不一致");
  });

  it("rejects malformed jsonl records with a useful path", () => {
    expect(() =>
      parseSyncFolderFiles([
        {
          path: "TypingLab/sessions/bad.jsonl",
          content: "{\"recordType\":\"unknown\",\"schemaVersion\":1}\n",
        },
      ]),
    ).toThrow("TypingLab/sessions/bad.jsonl:1");
  });

  it("rejects malformed session and event records in jsonl files", () => {
    expect(() =>
      parseSyncFolderFiles([
        {
          path: "TypingLab/sessions/bad-session.jsonl",
          content: `${JSON.stringify({ schemaVersion: 1, recordType: "session", session: { id: "s1" } })}\n`,
        },
      ]),
    ).toThrow("TypingLab/sessions/bad-session.jsonl:1");

    expect(() =>
      parseSyncFolderFiles([
        {
          path: "TypingLab/sessions/bad-event.jsonl",
          content: `${JSON.stringify({ schemaVersion: 1, recordType: "event", event: { eventId: "e1" } })}\n`,
        },
      ]),
    ).toThrow("TypingLab/sessions/bad-event.jsonl:1");
  });

  it("rejects malformed material files instead of silently skipping them", () => {
    expect(() =>
      parseSyncFolderFiles([
        {
          path: "TypingLab/materials/bad.json",
          content: JSON.stringify({ id: "pack_1", contentHash: "hash", items: [{}] }),
        },
      ]),
    ).toThrow("材料文件 TypingLab/materials/bad.json 格式错误");
  });

  it("rejects malformed sync folder manifest exports", () => {
    expect(() => parseSyncFolderExport("{")).toThrow("同步目录清单不是合法 JSON");
    expect(() => parseSyncFolderExport(JSON.stringify({ files: [{ path: "TypingLab/manifest.json" }] }))).toThrow(
      "files[0]",
    );
  });

  it("rejects malformed sync folder manifests with a product error", () => {
    expect(() =>
      parseSyncFolderFiles([
        {
          path: "TypingLab/manifest.json",
          content: "{",
        },
      ]),
    ).toThrow("同步目录 manifest 不是合法 JSON");
  });
});
