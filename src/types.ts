export type TrainingMode =
  | "wubi-code"
  | "chinese-real"
  | "english"
  | "code"
  | "vim";

export type EventType =
  | "session_started"
  | "keydown"
  | "input"
  | "long_pause"
  | "composition_start"
  | "composition_update"
  | "composition_end"
  | "paste"
  | "hint_used"
  | "session_completed"
  | "material_imported"
  | "material_created"
  | "material_deleted"
  | "material_restored";

export interface ExerciseItem {
  id: string;
  mode: TrainingMode;
  prompt: string;
  targetText: string;
  expectedCodes?: string[];
  category: string;
  tags: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  source: string;
  explanation?: string;
  contentHash: string;
}

export interface MaterialPack {
  id: string;
  name: string;
  description: string;
  version: number;
  source: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  items: ExerciseItem[];
}

export interface InputEventLog {
  eventId: string;
  sessionId: string;
  deviceId: string;
  type: EventType;
  occurredAt: string;
  sequence: number;
  payload: Record<string, unknown>;
}

export interface SessionMetrics {
  charsPerMinute: number;
  accuracy: number;
  backspaces: number;
  backspacePer100Chars: number;
  pauseCountOver1500Ms: number;
  maxPauseMs: number;
  correctUnits: number;
  totalUnits: number;
  hintUsed: boolean;
  hintCount: number;
  pasteEventCount?: number;
  compositionEventCount: number;
  wrongKeys: string[];
  weakTargets: string[];
  errorPositions: number[];
}

export interface TrainingSession {
  id: string;
  deviceId: string;
  mode: TrainingMode;
  materialId?: string;
  itemId: string;
  targetText: string;
  inputText: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  metrics: SessionMetrics;
}

export interface AppSettings {
  id: string;
  deviceId: string;
  deviceName: string;
  dailyTargetMinutes: number;
  syncFolderHint: string;
  theme: "dark" | "light";
  lastSyncExportAt?: string;
  lastSyncImportAt?: string;
}

export interface SyncDataFingerprint {
  schemaVersion: 1;
  algorithm: "fnv1a64-stable-json-v1";
  value: string;
  shortValue: string;
  counts: {
    sessions: number;
    events: number;
    materials: number;
  };
}

export interface SyncPackage {
  schemaVersion: 1;
  exportedAt: string;
  deviceId: string;
  dataFingerprint?: SyncDataFingerprint;
  sessions: TrainingSession[];
  events: InputEventLog[];
  materials: MaterialPack[];
}

export interface MergeResult {
  addedSessions: number;
  addedEvents: number;
  addedMaterials: number;
  skippedSessions: number;
  skippedEvents: number;
  skippedMaterials: number;
}

export interface TrendPoint {
  date: string;
  minutes: number;
  sessions: number;
  charsPerMinute: number;
  accuracy: number;
  backspacePer100Chars: number;
}
