import type {
  InputEventLog,
  MaterialPack,
  SyncDataFingerprint,
  SyncPackage,
  TrainingSession,
} from "../types";
import { sessionsToCsv } from "./csv";
import { localDateKey } from "./date";
import {
  assertSyncDataFingerprint,
  buildSyncDataFingerprint,
} from "./syncFingerprint";
import { isInputEventLog, isMaterialPack, isTrainingSession } from "./syncValidation";

export interface SyncFolderFile {
  path: string;
  mediaType: string;
  content: string;
  recordCount?: number;
}

export interface SyncFolderManifestFile {
  path: string;
  mediaType: string;
  bytes: number;
  recordCount?: number;
}

export interface SyncFolderManifest {
  schemaVersion: 1;
  layoutVersion: 1;
  exportedAt: string;
  deviceId: string;
  root: "TypingLab";
  dataFingerprint?: SyncDataFingerprint;
  counts: {
    sessions: number;
    events: number;
    materials: number;
    files: number;
  };
  files: SyncFolderManifestFile[];
}

export interface SyncFolderExport {
  manifest: SyncFolderManifest;
  files: SyncFolderFile[];
}

type SessionJsonlRecord = {
  recordType: "session";
  schemaVersion: 1;
  occurredAt: string;
  session: TrainingSession;
};

type EventJsonlRecord = {
  recordType: "event";
  schemaVersion: 1;
  occurredAt: string;
  event: InputEventLog;
};

type SyncFolderJsonlRecord = SessionJsonlRecord | EventJsonlRecord;

export function createSyncFolderExport(
  deviceId: string,
  sessions: TrainingSession[],
  events: InputEventLog[],
  materials: MaterialPack[],
  exportedAt = new Date().toISOString(),
): SyncFolderExport {
  const files: SyncFolderFile[] = [];
  const sessionBuckets = new Map<string, SyncFolderJsonlRecord[]>();
  const dataFingerprint = buildSyncDataFingerprint(sessions, events, materials);

  for (const session of sessions) {
    const key = bucketKey(session.deviceId, session.startedAt);
    const bucket = sessionBuckets.get(key) ?? [];
    bucket.push({
      recordType: "session",
      schemaVersion: 1,
      occurredAt: session.startedAt,
      session,
    });
    sessionBuckets.set(key, bucket);
  }

  for (const event of events) {
    const key = bucketKey(event.deviceId, event.occurredAt);
    const bucket = sessionBuckets.get(key) ?? [];
    bucket.push({
      recordType: "event",
      schemaVersion: 1,
      occurredAt: event.occurredAt,
      event,
    });
    sessionBuckets.set(key, bucket);
  }

  for (const [key, records] of Array.from(sessionBuckets.entries()).sort()) {
    const [date, sourceDeviceId] = key.split("|");
    const sortedRecords = records.sort((left, right) => {
      const time = left.occurredAt.localeCompare(right.occurredAt);
      return time === 0 ? recordOrder(left) - recordOrder(right) : time;
    });
    files.push({
      path: `TypingLab/sessions/${date}-${safeFilename(sourceDeviceId)}.jsonl`,
      mediaType: "application/x-ndjson",
      content: toJsonl(sortedRecords),
      recordCount: sortedRecords.length,
    });
  }

  for (const material of [...materials].sort((left, right) => left.id.localeCompare(right.id))) {
    files.push({
      path: `TypingLab/materials/${safeFilename(material.id)}-${material.contentHash.slice(0, 10)}.json`,
      mediaType: "application/json",
      content: `${JSON.stringify(material, null, 2)}\n`,
      recordCount: material.items.length,
    });
  }

  files.push({
    path: `TypingLab/snapshots/${localDateKey(exportedAt)}-${safeFilename(deviceId)}.json`,
    mediaType: "application/json",
    content: `${JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt,
        deviceId,
        dataFingerprint,
        counts: {
          sessions: sessions.length,
          events: events.length,
          materials: materials.length,
        },
      },
      null,
      2,
    )}\n`,
  });

  files.push({
    path: `TypingLab/exports/sessions-${localDateKey(exportedAt)}.csv`,
    mediaType: "text/csv;charset=utf-8",
    content: sessionsToCsv(sessions),
    recordCount: sessions.length,
  });

  const manifest: SyncFolderManifest = {
    schemaVersion: 1,
    layoutVersion: 1,
    exportedAt,
    deviceId,
    root: "TypingLab",
    dataFingerprint,
    counts: {
      sessions: sessions.length,
      events: events.length,
      materials: materials.length,
      files: files.length + 1,
    },
    files: [
      {
        path: "TypingLab/manifest.json",
        mediaType: "application/json",
        bytes: 0,
      },
      ...files.map((file) => ({
        path: file.path,
        mediaType: file.mediaType,
        bytes: byteLength(file.content),
        recordCount: file.recordCount,
      })),
    ],
  };

  const manifestContent = finalizeManifestContent(manifest);

  return {
    manifest,
    files: [
      {
        path: "TypingLab/manifest.json",
        mediaType: "application/json",
        content: manifestContent,
      },
      ...files,
    ],
  };
}

export function encodeSyncFolderExport(folderExport: SyncFolderExport): string {
  return `${JSON.stringify(folderExport, null, 2)}\n`;
}

export function parseSyncFolderExport(content: string): SyncPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("同步目录清单不是合法 JSON。");
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
    throw new Error("同步目录清单格式错误：缺少 files 数组。");
  }

  const files = parsed.files.map((file, index) => {
    if (!isRecord(file) || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error(`同步目录清单 files[${index}] 缺少 path/content。`);
    }
    return {
      path: file.path,
      content: file.content,
    };
  });

  return parseSyncFolderFiles(files);
}

export function parseSyncFolderFiles(
  files: Array<Pick<SyncFolderFile, "path" | "content">>,
): SyncPackage {
  const manifest = parseManifest(files.find((file) => file.path.endsWith("/manifest.json"))?.content);
  if (manifest) {
    validateManifestCompleteness(files, manifest);
    const manifestPaths = new Set(manifest.files.map((file) => file.path));
    const manifestCollections = parseSyncFolderCollections(
      files.filter((file) => manifestPaths.has(file.path)),
    );
    assertSyncDataFingerprint(
      manifest.dataFingerprint,
      manifestCollections.sessions,
      manifestCollections.events,
      manifestCollections.materials,
      "同步目录 manifest",
    );
  }

  const collections = parseSyncFolderCollections(files);

  return {
    schemaVersion: 1,
    exportedAt: manifest?.exportedAt ?? new Date().toISOString(),
    deviceId: manifest?.deviceId ?? "sync_folder",
    dataFingerprint: buildSyncDataFingerprint(
      collections.sessions,
      collections.events,
      collections.materials,
    ),
    sessions: collections.sessions,
    events: collections.events,
    materials: collections.materials,
  };
}

function parseSyncFolderCollections(
  files: Array<Pick<SyncFolderFile, "path" | "content">>,
): {
  sessions: TrainingSession[];
  events: InputEventLog[];
  materials: MaterialPack[];
} {
  const sessions = new Map<string, TrainingSession>();
  const events = new Map<string, InputEventLog>();
  const materials = new Map<string, MaterialPack>();

  for (const file of files) {
    if (file.path.includes("/sessions/") && file.path.endsWith(".jsonl")) {
      for (const record of parseSessionRecords(file)) {
        if (record.recordType === "session") {
          sessions.set(record.session.id, record.session);
        } else {
          events.set(record.event.eventId, record.event);
        }
      }
    }

    if (file.path.includes("/materials/") && file.path.endsWith(".json")) {
      const material = parseJsonFile<MaterialPack>(file, "材料文件");
      if (isMaterialPack(material)) {
        materials.set(`${material.id}:${material.contentHash}`, material);
      } else {
        throw new Error(`材料文件 ${file.path} 格式错误。`);
      }
    }
  }

  return {
    sessions: Array.from(sessions.values()),
    events: Array.from(events.values()),
    materials: Array.from(materials.values()),
  };
}

function parseSessionRecords(file: Pick<SyncFolderFile, "path" | "content">): SyncFolderJsonlRecord[] {
  return file.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = parseJsonLine(line, file.path, index + 1);
      if (!isSessionRecord(parsed)) {
        throw new Error(`${file.path}:${index + 1} 不是支持的 session/event 记录。`);
      }
      return parsed;
    });
}

function parseManifest(content: string | undefined): SyncFolderManifest | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("同步目录 manifest 不是合法 JSON。");
  }
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.layoutVersion !== 1 ||
    typeof parsed.exportedAt !== "string" ||
    typeof parsed.deviceId !== "string" ||
    parsed.root !== "TypingLab" ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error("同步目录 manifest 格式不受支持。");
  }
  return parsed as unknown as SyncFolderManifest;
}

function validateManifestCompleteness(
  files: Array<Pick<SyncFolderFile, "path" | "content">>,
  manifest: SyncFolderManifest,
): void {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const missingPaths: string[] = [];
  const mismatchedPaths: string[] = [];

  for (const manifestFile of manifest.files) {
    if (
      !isRecord(manifestFile) ||
      typeof manifestFile.path !== "string" ||
      typeof manifestFile.bytes !== "number"
    ) {
      throw new Error("同步目录 manifest 格式不受支持。");
    }

    const file = fileByPath.get(manifestFile.path);
    if (!file) {
      missingPaths.push(manifestFile.path);
      continue;
    }

    if (byteLength(file.content) !== manifestFile.bytes) {
      mismatchedPaths.push(manifestFile.path);
    }
  }

  if (missingPaths.length > 0) {
    throw new Error(
      `同步目录尚未同步完成：缺少 ${summarizePaths(missingPaths)}。请等待文件同步完成后再读取。`,
    );
  }

  if (mismatchedPaths.length > 0) {
    throw new Error(
      `同步目录文件内容不完整：${summarizePaths(mismatchedPaths)}。请等待文件同步完成后再读取。`,
    );
  }
}

function parseJsonFile<T>(
  file: Pick<SyncFolderFile, "path" | "content">,
  label: string,
): T {
  try {
    return JSON.parse(file.content) as T;
  } catch {
    throw new Error(`${label} ${file.path} 不是合法 JSON。`);
  }
}

function parseJsonLine(line: string, path: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new Error(`${path}:${lineNumber} 不是合法 JSONL。`);
  }
}

function isSessionRecord(value: unknown): value is SyncFolderJsonlRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.recordType === "session") {
    return isTrainingSession(value.session);
  }
  if (value.recordType === "event") {
    return isInputEventLog(value.event);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bucketKey(deviceId: string, isoDate: string): string {
  return `${localDateKey(isoDate)}|${deviceId}`;
}

function recordOrder(record: SyncFolderJsonlRecord): number {
  return record.recordType === "session" ? 0 : record.event.sequence;
}

function toJsonl(records: SyncFolderJsonlRecord[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function summarizePaths(paths: string[]): string {
  const visiblePaths = paths.slice(0, 3).join("、");
  return paths.length > 3 ? `${visiblePaths} 等 ${paths.length} 个文件` : visiblePaths;
}

function finalizeManifestContent(manifest: SyncFolderManifest): string {
  let content = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    content = `${JSON.stringify(manifest, null, 2)}\n`;
    const bytes = byteLength(content);
    if (manifest.files[0].bytes === bytes) {
      return content;
    }
    manifest.files[0] = {
      ...manifest.files[0],
      bytes,
    };
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
