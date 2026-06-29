import type {
  InputEventLog,
  MaterialPack,
  MergeResult,
  SyncDataFingerprint,
  SyncPackage,
  TrainingSession,
} from "../types";
import {
  assertSyncDataFingerprint,
  buildSyncDataFingerprint,
} from "./syncFingerprint";
import { assertValidSyncCollections } from "./syncValidation";

export interface SyncMergeCounts {
  sessions: number;
  events: number;
  materials: number;
}

export interface SyncMergePreview {
  exportedAt: string;
  deviceId: string;
  incoming: SyncMergeCounts;
  local: SyncMergeCounts;
  final: SyncMergeCounts;
  fingerprints: {
    incoming: SyncDataFingerprint;
    local: SyncDataFingerprint;
    final: SyncDataFingerprint;
    incomingMatchesLocal: boolean;
  };
  result: MergeResult;
  materialNotices: SyncMaterialMergeNotice[];
  hasChanges: boolean;
}

export interface SyncMaterialMergeNotice {
  kind: "deduplicated" | "name-conflict" | "id-conflict";
  name: string;
  incomingId: string;
  resolvedId: string;
  existingId?: string;
  incomingHash: string;
  existingHash?: string;
  detail: string;
}

export function createSyncPackage(
  deviceId: string,
  sessions: TrainingSession[],
  events: InputEventLog[],
  materials: MaterialPack[],
): SyncPackage {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    deviceId,
    dataFingerprint: buildSyncDataFingerprint(sessions, events, materials),
    sessions,
    events,
    materials,
  };
}

export function mergeSyncCollections(
  localSessions: TrainingSession[],
  localEvents: InputEventLog[],
  localMaterials: MaterialPack[],
  incoming: SyncPackage,
): {
  sessions: TrainingSession[];
  events: InputEventLog[];
  materials: MaterialPack[];
  result: MergeResult;
  materialNotices: SyncMaterialMergeNotice[];
} {
  const sessionIds = new Set(localSessions.map((session) => session.id));
  const eventIds = new Set(localEvents.map((event) => event.eventId));
  const materialIds = new Set(localMaterials.map((material) => material.id));
  const materialKeys = new Set(
    localMaterials.map((material) => `${material.name}:${material.contentHash}`),
  );
  const materialByKey = new Map(
    localMaterials.map((material) => [
      `${material.name}:${material.contentHash}`,
      material,
    ]),
  );
  const materialsByName = new Map<string, MaterialPack[]>();
  for (const material of localMaterials) {
    const bucket = materialsByName.get(material.name) ?? [];
    bucket.push(material);
    materialsByName.set(material.name, bucket);
  }
  const materialIdRemap = new Map<string, string>();
  const materialNotices: SyncMaterialMergeNotice[] = [];

  const result: MergeResult = {
    addedSessions: 0,
    addedEvents: 0,
    addedMaterials: 0,
    skippedSessions: 0,
    skippedEvents: 0,
    skippedMaterials: 0,
  };

  const materials = [...localMaterials];
  for (const material of incoming.materials) {
    const key = `${material.name}:${material.contentHash}`;
    if (materialKeys.has(key)) {
      const existing = materialByKey.get(key);
      if (existing) {
        materialIdRemap.set(material.id, existing.id);
        if (existing.id !== material.id) {
          materialNotices.push({
            kind: "deduplicated",
            name: material.name,
            incomingId: material.id,
            resolvedId: existing.id,
            existingId: existing.id,
            incomingHash: material.contentHash,
            existingHash: existing.contentHash,
            detail: "同名同内容材料已跳过，导入训练记录会引用本机已有材料。",
          });
        }
      }
      result.skippedMaterials += 1;
    } else {
      let materialId = material.id;
      const sameNameDifferentContent = (materialsByName.get(material.name) ?? []).find(
        (existing) => existing.contentHash !== material.contentHash,
      );
      if (materialIds.has(materialId)) {
        const existing = localMaterials.find((candidate) => candidate.id === materialId);
        materialId = createImportedMaterialId(material, materialIds);
        materialNotices.push({
          kind: "id-conflict",
          name: material.name,
          incomingId: material.id,
          resolvedId: materialId,
          existingId: existing?.id,
          incomingHash: material.contentHash,
          existingHash: existing?.contentHash,
          detail: "材料 ID 已存在但内容不同，导入时会生成新 ID，并把导入会话重映射到新材料。",
        });
      } else if (sameNameDifferentContent) {
        materialNotices.push({
          kind: "name-conflict",
          name: material.name,
          incomingId: material.id,
          resolvedId: materialId,
          existingId: sameNameDifferentContent.id,
          incomingHash: material.contentHash,
          existingHash: sameNameDifferentContent.contentHash,
          detail: "发现同名不同内容材料，导入时会保留两个版本。",
        });
      }
      materialIds.add(materialId);
      materialIdRemap.set(material.id, materialId);
      materialKeys.add(key);
      materialByKey.set(key, { ...material, id: materialId });
      const nameBucket = materialsByName.get(material.name) ?? [];
      nameBucket.push({ ...material, id: materialId });
      materialsByName.set(material.name, nameBucket);
      materials.push({
        ...material,
        id: materialId,
      });
      result.addedMaterials += 1;
    }
  }

  const sessions = [...localSessions];
  for (const session of incoming.sessions) {
    if (sessionIds.has(session.id)) {
      result.skippedSessions += 1;
    } else {
      sessionIds.add(session.id);
      sessions.push({
        ...session,
        materialId: session.materialId
          ? materialIdRemap.get(session.materialId) ?? session.materialId
          : undefined,
      });
      result.addedSessions += 1;
    }
  }

  const events = [...localEvents];
  for (const event of incoming.events) {
    if (eventIds.has(event.eventId)) {
      result.skippedEvents += 1;
    } else {
      eventIds.add(event.eventId);
      events.push(event);
      result.addedEvents += 1;
    }
  }

  const finalMaterials = applyMaterialDeletionEvents(materials, sessions, events);

  return {
    sessions: sessions.sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    events: events.sort((left, right) => {
      const time = left.occurredAt.localeCompare(right.occurredAt);
      return time === 0 ? left.sequence - right.sequence : time;
    }),
    materials: finalMaterials,
    result,
    materialNotices,
  };
}

function applyMaterialDeletionEvents(
  materials: MaterialPack[],
  sessions: TrainingSession[],
  events: InputEventLog[],
): MaterialPack[] {
  const referencedMaterialIds = new Set(
    sessions.map((session) => session.materialId).filter((materialId): materialId is string => Boolean(materialId)),
  );
  const latestDeletionByMaterialId = new Map<string, string>();

  for (const event of events) {
    if (event.type !== "material_deleted") continue;
    const materialId = readStringPayload(event.payload, "materialId");
    if (!materialId) continue;
    const previous = latestDeletionByMaterialId.get(materialId);
    if (!previous || event.occurredAt > previous) {
      latestDeletionByMaterialId.set(materialId, event.occurredAt);
    }
  }

  if (latestDeletionByMaterialId.size === 0) return materials;

  return materials.filter((material) => {
    if (referencedMaterialIds.has(material.id)) return true;
    const deletedAt = latestDeletionByMaterialId.get(material.id);
    if (!deletedAt) return true;
    return deletedAt < material.updatedAt;
  });
}

function readStringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value ? value : undefined;
}

export function previewSyncMerge(
  localSessions: TrainingSession[],
  localEvents: InputEventLog[],
  localMaterials: MaterialPack[],
  incoming: SyncPackage,
): SyncMergePreview {
  const merged = mergeSyncCollections(localSessions, localEvents, localMaterials, incoming);
  const localFingerprint = buildSyncDataFingerprint(localSessions, localEvents, localMaterials);
  const incomingFingerprint =
    incoming.dataFingerprint ?? buildSyncDataFingerprint(incoming.sessions, incoming.events, incoming.materials);
  const finalFingerprint = buildSyncDataFingerprint(merged.sessions, merged.events, merged.materials);
  const hasChanges =
    merged.result.addedSessions > 0 ||
    merged.result.addedEvents > 0 ||
    merged.result.addedMaterials > 0;

  return {
    exportedAt: incoming.exportedAt,
    deviceId: incoming.deviceId,
    incoming: {
      sessions: incoming.sessions.length,
      events: incoming.events.length,
      materials: incoming.materials.length,
    },
    local: {
      sessions: localSessions.length,
      events: localEvents.length,
      materials: localMaterials.length,
    },
    final: {
      sessions: merged.sessions.length,
      events: merged.events.length,
      materials: merged.materials.length,
    },
    fingerprints: {
      incoming: incomingFingerprint,
      local: localFingerprint,
      final: finalFingerprint,
      incomingMatchesLocal: incomingFingerprint.value === localFingerprint.value,
    },
    result: merged.result,
    materialNotices: merged.materialNotices,
    hasChanges,
  };
}

function createImportedMaterialId(material: MaterialPack, usedIds: Set<string>): string {
  const suffix = material.contentHash.slice(0, 10) || Date.now().toString(36);
  let candidate = `${material.id}_imported_${suffix}`;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = `${material.id}_imported_${suffix}_${index}`;
    index += 1;
  }
  return candidate;
}

export function parseSyncPackage(content: string): SyncPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("同步包不是合法 JSON。");
  }

  if (!isRecord(parsed)) {
    throw new Error("同步包格式错误：根节点必须是对象。");
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error("同步包版本不受支持。");
  }
  if (typeof parsed.deviceId !== "string" || !parsed.deviceId) {
    throw new Error("同步包缺少 deviceId。");
  }
  if (!Array.isArray(parsed.sessions) || !Array.isArray(parsed.events) || !Array.isArray(parsed.materials)) {
    throw new Error("同步包缺少 sessions/events/materials 数组。");
  }

  const collections = {
    sessions: parsed.sessions as unknown[],
    events: parsed.events as unknown[],
    materials: parsed.materials as unknown[],
  };
  assertValidSyncCollections(collections, "同步包");
  const dataFingerprint = assertSyncDataFingerprint(
    parsed.dataFingerprint,
    collections.sessions,
    collections.events,
    collections.materials,
    "同步包",
  );

  return {
    schemaVersion: 1,
    exportedAt:
      typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    deviceId: parsed.deviceId,
    dataFingerprint,
    sessions: collections.sessions,
    events: collections.events,
    materials: collections.materials,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeJsonDownload(value: unknown): string {
  return URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
}

export function encodeJsonlDownload(events: InputEventLog[]): string {
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  return URL.createObjectURL(new Blob([body], { type: "application/x-ndjson" }));
}
