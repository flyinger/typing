import type {
  InputEventLog,
  MaterialPack,
  SyncDataFingerprint,
  TrainingSession,
} from "../types";
import { stableStringify } from "./hash";

const algorithm = "fnv1a64-stable-json-v1" as const;
const fnvOffsetBasis = 0xcbf29ce484222325n;
const fnvPrime = 0x100000001b3n;
const maxUint64 = 0xffffffffffffffffn;

export function buildSyncDataFingerprint(
  sessions: TrainingSession[],
  events: InputEventLog[],
  materials: MaterialPack[],
): SyncDataFingerprint {
  const canonical = stableStringify({
    schemaVersion: 1,
    sessions: sortByStableKey(sessions, (session) => session.id),
    events: sortByStableKey(events, (event) => event.eventId),
    materials: sortByStableKey(materials, (material) => `${material.id}:${material.contentHash}`),
  });
  const value = fnv1a64(canonical);

  return {
    schemaVersion: 1,
    algorithm,
    value,
    shortValue: value.slice(0, 12),
    counts: {
      sessions: sessions.length,
      events: events.length,
      materials: materials.length,
    },
  };
}

export function assertSyncDataFingerprint(
  expected: unknown,
  sessions: TrainingSession[],
  events: InputEventLog[],
  materials: MaterialPack[],
  label: string,
): SyncDataFingerprint {
  const computed = buildSyncDataFingerprint(sessions, events, materials);
  if (expected === undefined || expected === null) return computed;
  if (!isSyncDataFingerprint(expected)) {
    throw new Error(`${label}事实流摘要格式不受支持。`);
  }
  if (
    expected.value !== computed.value ||
    expected.counts.sessions !== computed.counts.sessions ||
    expected.counts.events !== computed.counts.events ||
    expected.counts.materials !== computed.counts.materials
  ) {
    throw new Error(
      `${label}事实流摘要不一致：文件可能未同步完成或内容被修改，请等待同步完成后重新读取。`,
    );
  }
  return computed;
}

export function syncFingerprintLabel(fingerprint: SyncDataFingerprint | undefined): string {
  return fingerprint?.shortValue ?? "未生成";
}

function sortByStableKey<T>(items: T[], getKey: (item: T) => string): T[] {
  return [...items].sort((left, right) => getKey(left).localeCompare(getKey(right)));
}

function fnv1a64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = fnvOffsetBasis;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * fnvPrime) & maxUint64;
  }

  return hash.toString(16).padStart(16, "0");
}

function isSyncDataFingerprint(value: unknown): value is SyncDataFingerprint {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1 || value.algorithm !== algorithm) return false;
  if (typeof value.value !== "string" || typeof value.shortValue !== "string") return false;
  if (!isRecord(value.counts)) return false;
  return (
    typeof value.counts.sessions === "number" &&
    typeof value.counts.events === "number" &&
    typeof value.counts.materials === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
