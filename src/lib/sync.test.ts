import { describe, expect, it } from "vitest";
import { createSyncPackage, mergeSyncCollections, parseSyncPackage, previewSyncMerge } from "./sync";
import type { InputEventLog, MaterialPack, SyncPackage, TrainingSession } from "../types";

const session: TrainingSession = {
  id: "s1",
  deviceId: "d1",
  mode: "wubi-code",
  itemId: "i1",
  targetText: "中",
  inputText: "khk",
  startedAt: "2026-06-25T00:00:00.000Z",
  endedAt: "2026-06-25T00:00:03.000Z",
  durationMs: 3000,
  metrics: {
    charsPerMinute: 20,
    accuracy: 100,
    backspaces: 0,
    backspacePer100Chars: 0,
    pauseCountOver1500Ms: 0,
    maxPauseMs: 0,
    correctUnits: 3,
    totalUnits: 3,
    hintUsed: false,
    hintCount: 0,
    compositionEventCount: 0,
    wrongKeys: [],
    weakTargets: [],
    errorPositions: [],
  },
};

const material: MaterialPack = {
  id: "pack_1",
  name: "五笔材料",
  description: "test",
  version: 1,
  source: "test",
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
  contentHash: "hash_1",
  items: [],
};

function materialDeletedEvent(materialId = "pack_1"): InputEventLog {
  return {
    eventId: `delete_${materialId}`,
    sessionId: "material_maintenance",
    deviceId: "d2",
    type: "material_deleted",
    occurredAt: "2026-06-25T00:00:00.000Z",
    sequence: 1,
    payload: { materialId },
  };
}

describe("mergeSyncCollections", () => {
  it("creates stable data fingerprints and rejects mismatched sync package contents", () => {
    const completedEvent: InputEventLog = {
      eventId: "e1",
      sessionId: "s1",
      deviceId: "d1",
      type: "session_completed",
      occurredAt: "2026-06-25T00:00:03.000Z",
      sequence: 1,
      payload: {},
    };
    const pack = createSyncPackage("d1", [session], [completedEvent], [material]);
    const reorderedPack = createSyncPackage("d1", [session], [completedEvent], [material]);

    expect(pack.dataFingerprint).toMatchObject({
      algorithm: "fnv1a64-stable-json-v1",
      counts: { sessions: 1, events: 1, materials: 1 },
    });
    expect(reorderedPack.dataFingerprint?.value).toBe(pack.dataFingerprint?.value);
    expect(parseSyncPackage(JSON.stringify(pack)).dataFingerprint).toEqual(pack.dataFingerprint);

    const tampered = {
      ...pack,
      sessions: [{ ...session, inputText: "changed" }],
    };

    expect(() => parseSyncPackage(JSON.stringify(tampered))).toThrow("事实流摘要不一致");
  });

  it("deduplicates sessions and events by stable ids", () => {
    const incoming: SyncPackage = {
      schemaVersion: 1,
      exportedAt: "2026-06-25T00:00:05.000Z",
      deviceId: "d1",
      sessions: [session],
      events: [
        {
          eventId: "e1",
          sessionId: "s1",
          deviceId: "d1",
          type: "session_completed",
          occurredAt: "2026-06-25T00:00:03.000Z",
          sequence: 1,
          payload: {},
        },
      ],
      materials: [],
    };

    const merged = mergeSyncCollections([session], incoming.events, [], incoming);

    expect(merged.sessions).toHaveLength(1);
    expect(merged.events).toHaveLength(1);
    expect(merged.result.skippedSessions).toBe(1);
    expect(merged.result.skippedEvents).toBe(1);
  });

  it("remaps imported sessions when a material id collides with different content", () => {
    const localMaterial: MaterialPack = {
      id: "pack",
      name: "五笔材料",
      description: "local",
      version: 1,
      source: "local",
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
      contentHash: "localhash",
      items: [],
    };
    const incomingMaterial: MaterialPack = {
      ...localMaterial,
      description: "incoming",
      source: "ubuntu",
      contentHash: "incominghash",
    };
    const incomingSession: TrainingSession = {
      ...session,
      id: "s2",
      materialId: "pack",
    };
    const incoming: SyncPackage = {
      schemaVersion: 1,
      exportedAt: "2026-06-25T00:00:05.000Z",
      deviceId: "d2",
      sessions: [incomingSession],
      events: [],
      materials: [incomingMaterial],
    };

    const merged = mergeSyncCollections([], [], [localMaterial], incoming);
    const importedMaterial = merged.materials.find(
      (material) => material.contentHash === "incominghash",
    );

    expect(importedMaterial?.id).not.toBe("pack");
    expect(merged.sessions[0].materialId).toBe(importedMaterial?.id);
  });

  it("applies material deletion events for unreferenced material packs", () => {
    const incoming: SyncPackage = {
      schemaVersion: 1,
      exportedAt: "2026-06-25T00:00:05.000Z",
      deviceId: "d2",
      sessions: [],
      events: [materialDeletedEvent()],
      materials: [material],
    };

    const merged = mergeSyncCollections([], [], [], incoming);

    expect(merged.events).toHaveLength(1);
    expect(merged.materials).toHaveLength(0);
  });

  it("keeps deleted material packs when historical sessions still reference them", () => {
    const referencedSession: TrainingSession = {
      ...session,
      materialId: "pack_1",
    };
    const incoming: SyncPackage = {
      schemaVersion: 1,
      exportedAt: "2026-06-25T00:00:05.000Z",
      deviceId: "d2",
      sessions: [],
      events: [materialDeletedEvent()],
      materials: [],
    };

    const merged = mergeSyncCollections([referencedSession], [], [material], incoming);

    expect(merged.events).toHaveLength(1);
    expect(merged.materials).toEqual([material]);
  });

  it("validates sync package shape before importing", () => {
    expect(() => parseSyncPackage("{")).toThrow("同步包不是合法 JSON");
    expect(() => parseSyncPackage(JSON.stringify({ schemaVersion: 2 }))).toThrow(
      "同步包版本不受支持",
    );
  });

  it("rejects malformed sync package records before merge preview", () => {
    const validPackage = createSyncPackage("d1", [session], [
      {
        eventId: "e1",
        sessionId: "s1",
        deviceId: "d1",
        type: "session_completed",
        occurredAt: "2026-06-25T00:00:03.000Z",
        sequence: 1,
        payload: {},
      },
    ], [material]);

    expect(() =>
      parseSyncPackage(JSON.stringify({
        ...validPackage,
        sessions: [{ ...session, mode: "bad-mode" }],
        dataFingerprint: undefined,
      })),
    ).toThrow("同步包 sessions[0] 格式错误");

    expect(() =>
      parseSyncPackage(JSON.stringify({
        ...validPackage,
        events: [{ ...validPackage.events[0], type: "bad-event" }],
        dataFingerprint: undefined,
      })),
    ).toThrow("同步包 events[0] 格式错误");

    expect(() =>
      parseSyncPackage(JSON.stringify({
        ...validPackage,
        materials: [{ ...material, items: [{}] }],
        dataFingerprint: undefined,
      })),
    ).toThrow("同步包 materials[0] 格式错误");
  });
});

describe("previewSyncMerge", () => {
  it("summarizes incoming, local and final counts before writing data", () => {
    const incoming: SyncPackage = {
      schemaVersion: 1,
      exportedAt: "2026-06-25T00:00:05.000Z",
      deviceId: "d2",
      sessions: [session],
      events: [],
      materials: [],
    };

    const preview = previewSyncMerge([], [], [], incoming);

    expect(preview).toMatchObject({
      deviceId: "d2",
      incoming: { sessions: 1, events: 0, materials: 0 },
      local: { sessions: 0, events: 0, materials: 0 },
      final: { sessions: 1, events: 0, materials: 0 },
      hasChanges: true,
    });
    expect(preview.result.addedSessions).toBe(1);
  });

  it("marks duplicate imports as having no changes", () => {
    const incoming: SyncPackage = {
      schemaVersion: 1,
      exportedAt: "2026-06-25T00:00:05.000Z",
      deviceId: "d1",
      sessions: [session],
      events: [],
      materials: [],
    };

    const preview = previewSyncMerge([session], [], [], incoming);

    expect(preview.hasChanges).toBe(false);
    expect(preview.result.skippedSessions).toBe(1);
    expect(preview.final.sessions).toBe(1);
  });

  it("surfaces material merge notices before confirming an import", () => {
    const localMaterial: MaterialPack = {
      id: "shared",
      name: "专业材料",
      description: "local",
      version: 1,
      source: "mac",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      contentHash: "localhash",
      items: [],
    };
    const sameNameDifferentContent: MaterialPack = {
      ...localMaterial,
      id: "ubuntu-pack",
      description: "ubuntu",
      source: "ubuntu",
      contentHash: "ubuntuhash",
    };
    const sameIdDifferentContent: MaterialPack = {
      ...localMaterial,
      description: "same id different content",
      source: "ubuntu",
      contentHash: "conflicthash",
    };
    const duplicateDifferentId: MaterialPack = {
      ...localMaterial,
      id: "duplicate-id",
    };
    const incoming: SyncPackage = {
      schemaVersion: 1,
      exportedAt: "2026-06-25T00:00:05.000Z",
      deviceId: "d2",
      sessions: [],
      events: [],
      materials: [sameNameDifferentContent, sameIdDifferentContent, duplicateDifferentId],
    };

    const preview = previewSyncMerge([], [], [localMaterial], incoming);

    expect(preview.materialNotices.map((notice) => notice.kind)).toEqual([
      "name-conflict",
      "id-conflict",
      "deduplicated",
    ]);
    expect(preview.materialNotices[0]).toMatchObject({
      name: "专业材料",
      incomingId: "ubuntu-pack",
      resolvedId: "ubuntu-pack",
      existingId: "shared",
    });
    expect(preview.materialNotices[1].resolvedId).toContain("shared_imported_conflictha");
    expect(preview.materialNotices[2]).toMatchObject({
      incomingId: "duplicate-id",
      resolvedId: "shared",
    });
  });
});
