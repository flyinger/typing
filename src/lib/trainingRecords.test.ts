import { describe, expect, it } from "vitest";
import type { InputEventLog, SessionMetrics, TrainingSession } from "../types";
import {
  mergeCompletedTrainingRecords,
  sortInputEventsForTimeline,
  sortTrainingSessionsNewestFirst,
} from "./trainingRecords";

const metrics: SessionMetrics = {
  charsPerMinute: 80,
  accuracy: 98,
  backspaces: 1,
  backspacePer100Chars: 4,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  correctUnits: 20,
  totalUnits: 20,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
  weakTargets: [],
  errorPositions: [],
};

function session(id: string, startedAt: string): TrainingSession {
  return {
    id,
    deviceId: "device",
    mode: "english",
    itemId: `${id}-item`,
    targetText: "offline first training data",
    inputText: "offline first training data",
    startedAt,
    endedAt: startedAt,
    durationMs: 15000,
    metrics,
  };
}

function event(eventId: string, sessionId: string, sequence: number, occurredAt: string): InputEventLog {
  return {
    eventId,
    sessionId,
    deviceId: "device",
    type: "input",
    occurredAt,
    sequence,
    payload: { value: eventId },
  };
}

describe("trainingRecords", () => {
  it("sorts sessions newest first for UI state", () => {
    expect(
      sortTrainingSessionsNewestFirst([
        session("older", "2026-06-20T08:00:00.000Z"),
        session("newer", "2026-06-21T08:00:00.000Z"),
      ]).map((entry) => entry.id),
    ).toEqual(["newer", "older"]);
  });

  it("sorts events by time and sequence for deterministic state", () => {
    expect(
      sortInputEventsForTimeline([
        event("third", "s2", 1, "2026-06-21T08:00:01.000Z"),
        event("second", "s1", 2, "2026-06-21T08:00:00.000Z"),
        event("first", "s1", 1, "2026-06-21T08:00:00.000Z"),
      ]).map((entry) => entry.eventId),
    ).toEqual(["first", "second", "third"]);
  });

  it("merges a completed session into memory state without duplicating records", () => {
    const existingSession = session("existing", "2026-06-20T08:00:00.000Z");
    const newSession = session("new", "2026-06-21T08:00:00.000Z");
    const existingEvent = event("existing-event", "existing", 1, "2026-06-20T08:00:00.000Z");
    const newEvent = event("new-event", "new", 1, "2026-06-21T08:00:00.000Z");

    const merged = mergeCompletedTrainingRecords(
      [existingSession, newSession],
      [existingEvent, newEvent],
      newSession,
      [newEvent],
    );

    expect(merged.sessions.map((entry) => entry.id)).toEqual(["new", "existing"]);
    expect(merged.events.map((entry) => entry.eventId)).toEqual(["existing-event", "new-event"]);
  });
});
