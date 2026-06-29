import { describe, expect, it } from "vitest";
import type { InputEventLog, MaterialPack, SessionMetrics, TrainingMode, TrainingSession } from "../types";
import { buildSyncDataFingerprint } from "./syncFingerprint";
import { createSyncFolderExport, parseSyncFolderFiles, type SyncFolderExport } from "./syncFolder";
import { mergeSyncCollections } from "./sync";

const metrics: SessionMetrics = {
  charsPerMinute: 90,
  accuracy: 98,
  backspaces: 1,
  backspacePer100Chars: 4,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  correctUnits: 18,
  totalUnits: 18,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
  weakTargets: [],
  errorPositions: [],
};

function material(overrides: Partial<MaterialPack> = {}): MaterialPack {
  return {
    id: "foundation_pack",
    name: "底座材料",
    description: "English and code baseline",
    version: 1,
    source: "test",
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z",
    contentHash: "foundationhash",
    items: [],
    ...overrides,
  };
}

function session(
  id: string,
  deviceId: string,
  mode: TrainingMode,
  startedAt: string,
  materialId = "foundation_pack",
): TrainingSession {
  const targetText = mode === "code" ? "const targetCpm = 80;" : "offline first training";
  return {
    id,
    deviceId,
    mode,
    materialId,
    itemId: `${id}_item`,
    targetText,
    inputText: targetText,
    startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + 15000).toISOString(),
    durationMs: 15000,
    metrics,
  };
}

function eventsFor(sessionEntry: TrainingSession): InputEventLog[] {
  return [
    {
      eventId: `${sessionEntry.id}_started`,
      sessionId: sessionEntry.id,
      deviceId: sessionEntry.deviceId,
      type: "session_started",
      occurredAt: sessionEntry.startedAt,
      sequence: 1,
      payload: {},
    },
    {
      eventId: `${sessionEntry.id}_completed`,
      sessionId: sessionEntry.id,
      deviceId: sessionEntry.deviceId,
      type: "session_completed",
      occurredAt: sessionEntry.endedAt,
      sequence: 2,
      payload: {},
    },
  ];
}

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

describe("cross-device sync roundtrip", () => {
  it("merges independent Mac and Ubuntu sessions to the same fingerprint on both devices", () => {
    const sharedMaterial = material();
    const macSession = session("mac_session", "device/mac", "english", "2026-06-26T08:00:00.000Z");
    const ubuntuSession = session("ubuntu_session", "device/ubuntu", "code", "2026-06-26T08:05:00.000Z");
    const macEvents = eventsFor(macSession);
    const ubuntuEvents = eventsFor(ubuntuSession);
    const macFolder = createSyncFolderExport(
      "device/mac",
      [macSession],
      macEvents,
      [sharedMaterial],
      "2026-06-26T09:00:00.000Z",
    );
    const ubuntuFolder = createSyncFolderExport(
      "device/ubuntu",
      [ubuntuSession],
      ubuntuEvents,
      [sharedMaterial],
      "2026-06-26T10:00:00.000Z",
    );

    const aggregatePackage = parseSyncFolderFiles(overlaySyncFolderFiles(macFolder, ubuntuFolder));
    const macMerged = mergeSyncCollections(
      [macSession],
      macEvents,
      [sharedMaterial],
      aggregatePackage,
    );
    const ubuntuMerged = mergeSyncCollections(
      [ubuntuSession],
      ubuntuEvents,
      [sharedMaterial],
      aggregatePackage,
    );
    const macFingerprint = buildSyncDataFingerprint(
      macMerged.sessions,
      macMerged.events,
      macMerged.materials,
    );
    const ubuntuFingerprint = buildSyncDataFingerprint(
      ubuntuMerged.sessions,
      ubuntuMerged.events,
      ubuntuMerged.materials,
    );
    const repeatImport = mergeSyncCollections(
      macMerged.sessions,
      macMerged.events,
      macMerged.materials,
      aggregatePackage,
    );

    expect(aggregatePackage.dataFingerprint).toMatchObject({
      counts: { sessions: 2, events: 4, materials: 1 },
    });
    expect(macMerged.result).toMatchObject({
      addedSessions: 1,
      addedEvents: 2,
      addedMaterials: 0,
    });
    expect(ubuntuMerged.result).toMatchObject({
      addedSessions: 1,
      addedEvents: 2,
      addedMaterials: 0,
    });
    expect(macFingerprint.value).toBe(ubuntuFingerprint.value);
    expect(repeatImport.result).toMatchObject({
      addedSessions: 0,
      addedEvents: 0,
      addedMaterials: 0,
      skippedSessions: 2,
      skippedEvents: 4,
      skippedMaterials: 1,
    });
  });

  it("remaps same-id material conflicts after a folder roundtrip", () => {
    const macMaterial = material({
      id: "personal_pack",
      description: "mac material",
      contentHash: "mac_material_hash",
    });
    const ubuntuMaterial = material({
      id: "personal_pack",
      description: "ubuntu material",
      contentHash: "ubuntu_material_hash",
    });
    const macSession = session(
      "mac_session",
      "device/mac",
      "english",
      "2026-06-26T08:00:00.000Z",
      "personal_pack",
    );
    const ubuntuSession = session(
      "ubuntu_session",
      "device/ubuntu",
      "code",
      "2026-06-26T08:05:00.000Z",
      "personal_pack",
    );
    const macFolder = createSyncFolderExport(
      "device/mac",
      [macSession],
      eventsFor(macSession),
      [macMaterial],
      "2026-06-26T09:00:00.000Z",
    );
    const ubuntuFolder = createSyncFolderExport(
      "device/ubuntu",
      [ubuntuSession],
      eventsFor(ubuntuSession),
      [ubuntuMaterial],
      "2026-06-26T10:00:00.000Z",
    );

    const aggregatePackage = parseSyncFolderFiles(overlaySyncFolderFiles(macFolder, ubuntuFolder));
    const merged = mergeSyncCollections(
      [macSession],
      eventsFor(macSession),
      [macMaterial],
      aggregatePackage,
    );
    const importedUbuntuMaterial = merged.materials.find(
      (entry) => entry.contentHash === "ubuntu_material_hash",
    );

    expect(aggregatePackage.materials.map((entry) => entry.contentHash).sort()).toEqual([
      "mac_material_hash",
      "ubuntu_material_hash",
    ]);
    expect(importedUbuntuMaterial?.id).not.toBe("personal_pack");
    expect(merged.sessions.find((entry) => entry.id === "ubuntu_session")?.materialId).toBe(
      importedUbuntuMaterial?.id,
    );
  });
});
