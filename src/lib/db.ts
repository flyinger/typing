import Dexie, { type EntityTable } from "dexie";
import type {
  AppSettings,
  InputEventLog,
  MaterialPack,
  TrainingSession,
} from "../types";
import { detectDeviceName, getOrCreateDeviceId } from "./device";
import { sampleMaterialPacks } from "../data/sampleMaterials";

export class TypingLabDatabase extends Dexie {
  sessions!: EntityTable<TrainingSession, "id">;
  events!: EntityTable<InputEventLog, "eventId">;
  materials!: EntityTable<MaterialPack, "id">;
  settings!: EntityTable<AppSettings, "id">;

  constructor() {
    super("typinglab");
    this.version(1).stores({
      sessions: "id, deviceId, mode, startedAt, itemId",
      events: "eventId, sessionId, deviceId, type, occurredAt",
      materials: "id, name, source, contentHash, updatedAt",
      settings: "id",
    });
  }
}

export const db = new TypingLabDatabase();

export async function ensureInitialized(): Promise<AppSettings> {
  let settings = await db.settings.get("main");
  if (!settings) {
    settings = {
      id: "main",
      deviceId: getOrCreateDeviceId(),
      deviceName: detectDeviceName(),
      dailyTargetMinutes: 20,
      syncFolderHint: "TypingLab/",
      theme: "dark",
    };
    await db.settings.put(settings);
  }

  await db.materials.bulkPut(await sampleMaterialPacks());

  return settings;
}

export async function replaceAllData(
  sessions: TrainingSession[],
  events: InputEventLog[],
  materials: MaterialPack[],
): Promise<void> {
  await db.transaction("rw", db.sessions, db.events, db.materials, async () => {
    await db.sessions.clear();
    await db.events.clear();
    await db.materials.clear();
    await db.sessions.bulkPut(sessions);
    await db.events.bulkPut(events);
    await db.materials.bulkPut(materials);
  });
}
