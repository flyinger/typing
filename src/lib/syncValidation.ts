import type {
  EventType,
  ExerciseItem,
  InputEventLog,
  MaterialPack,
  SessionMetrics,
  TrainingMode,
  TrainingSession,
} from "../types";

const trainingModes: TrainingMode[] = ["wubi-code", "chinese-real", "english", "code", "vim"];

const eventTypes: EventType[] = [
  "session_started",
  "keydown",
  "input",
  "long_pause",
  "composition_start",
  "composition_update",
  "composition_end",
  "paste",
  "hint_used",
  "session_completed",
  "material_imported",
  "material_created",
  "material_deleted",
  "material_restored",
];

interface UnknownSyncCollections {
  sessions: unknown[];
  events: unknown[];
  materials: unknown[];
}

interface ValidSyncCollections {
  sessions: TrainingSession[];
  events: InputEventLog[];
  materials: MaterialPack[];
}

export function assertValidSyncCollections(
  collections: UnknownSyncCollections,
  label: string,
): asserts collections is ValidSyncCollections {
  collections.sessions.forEach((session, index) => {
    if (!isTrainingSession(session)) {
      throw new Error(`${label} sessions[${index}] 格式错误。`);
    }
  });
  collections.events.forEach((event, index) => {
    if (!isInputEventLog(event)) {
      throw new Error(`${label} events[${index}] 格式错误。`);
    }
  });
  collections.materials.forEach((material, index) => {
    if (!isMaterialPack(material)) {
      throw new Error(`${label} materials[${index}] 格式错误。`);
    }
  });
}

export function isTrainingSession(value: unknown): value is TrainingSession {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.deviceId) &&
    isTrainingMode(value.mode) &&
    isOptionalString(value.materialId) &&
    isNonEmptyString(value.itemId) &&
    typeof value.targetText === "string" &&
    typeof value.inputText === "string" &&
    isNonEmptyString(value.startedAt) &&
    isNonEmptyString(value.endedAt) &&
    isFiniteNumber(value.durationMs) &&
    isSessionMetrics(value.metrics)
  );
}

export function isInputEventLog(value: unknown): value is InputEventLog {
  return (
    isRecord(value) &&
    isNonEmptyString(value.eventId) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.deviceId) &&
    isEventType(value.type) &&
    isNonEmptyString(value.occurredAt) &&
    isNonNegativeInteger(value.sequence) &&
    isRecord(value.payload)
  );
}

export function isMaterialPack(value: unknown): value is MaterialPack {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    typeof value.description === "string" &&
    isFiniteNumber(value.version) &&
    isNonEmptyString(value.source) &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt) &&
    isNonEmptyString(value.contentHash) &&
    Array.isArray(value.items) &&
    value.items.every(isExerciseItem)
  );
}

function isExerciseItem(value: unknown): value is ExerciseItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isTrainingMode(value.mode) &&
    typeof value.prompt === "string" &&
    typeof value.targetText === "string" &&
    isOptionalStringArray(value.expectedCodes) &&
    typeof value.category === "string" &&
    isStringArray(value.tags) &&
    isIntegerBetween(value.difficulty, 1, 5) &&
    isNonEmptyString(value.source) &&
    isOptionalString(value.explanation) &&
    isNonEmptyString(value.contentHash)
  );
}

function isSessionMetrics(value: unknown): value is SessionMetrics {
  return (
    isRecord(value) &&
    isFiniteNumber(value.charsPerMinute) &&
    isFiniteNumber(value.accuracy) &&
    isFiniteNumber(value.backspaces) &&
    isFiniteNumber(value.backspacePer100Chars) &&
    isFiniteNumber(value.pauseCountOver1500Ms) &&
    isFiniteNumber(value.maxPauseMs) &&
    isFiniteNumber(value.correctUnits) &&
    isFiniteNumber(value.totalUnits) &&
    typeof value.hintUsed === "boolean" &&
    isFiniteNumber(value.hintCount) &&
    (value.pasteEventCount === undefined || isFiniteNumber(value.pasteEventCount)) &&
    isFiniteNumber(value.compositionEventCount) &&
    isStringArray(value.wrongKeys) &&
    isStringArray(value.weakTargets) &&
    isNumberArray(value.errorPositions)
  );
}

function isTrainingMode(value: unknown): value is TrainingMode {
  return typeof value === "string" && trainingModes.includes(value as TrainingMode);
}

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && eventTypes.includes(value as EventType);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= min && value <= max;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || isStringArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
