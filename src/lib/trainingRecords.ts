import type { InputEventLog, TrainingSession } from "../types";

export interface TrainingRecordState {
  sessions: TrainingSession[];
  events: InputEventLog[];
}

export function mergeCompletedTrainingRecords(
  currentSessions: TrainingSession[],
  currentEvents: InputEventLog[],
  session: TrainingSession,
  sessionEvents: InputEventLog[],
): TrainingRecordState {
  return {
    sessions: sortTrainingSessionsNewestFirst(dedupeTrainingSessions([session, ...currentSessions])),
    events: sortInputEventsForTimeline(dedupeInputEvents([...currentEvents, ...sessionEvents])),
  };
}

export function dedupeTrainingSessions(sessions: TrainingSession[]): TrainingSession[] {
  const seen = new Set<string>();
  const result: TrainingSession[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    result.push(session);
  }
  return result;
}

export function dedupeInputEvents(events: InputEventLog[]): InputEventLog[] {
  const seen = new Set<string>();
  const result: InputEventLog[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    result.push(event);
  }
  return result;
}

export function sortTrainingSessionsNewestFirst(sessions: TrainingSession[]): TrainingSession[] {
  return [...sessions].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function sortInputEventsForTimeline(events: InputEventLog[]): InputEventLog[] {
  return [...events].sort((left, right) => {
    const timeOrder = left.occurredAt.localeCompare(right.occurredAt);
    if (timeOrder !== 0) return timeOrder;
    const sessionOrder = left.sessionId.localeCompare(right.sessionId);
    if (sessionOrder !== 0) return sessionOrder;
    return left.sequence - right.sequence;
  });
}
