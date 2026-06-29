import Papa from "papaparse";
import type { TrainingSession } from "../types";

export function sessionsToCsv(sessions: TrainingSession[]): string {
  return Papa.unparse(
    sessions.map((session) => ({
      id: session.id,
      device_id: session.deviceId,
      mode: session.mode,
      started_at: session.startedAt,
      duration_ms: session.durationMs,
      target_text: session.targetText,
      input_text: session.inputText,
      chars_per_minute: session.metrics.charsPerMinute,
      accuracy: session.metrics.accuracy,
      backspaces: session.metrics.backspaces,
      backspace_per_100_chars: session.metrics.backspacePer100Chars,
      pause_count_over_1500_ms: session.metrics.pauseCountOver1500Ms,
      max_pause_ms: session.metrics.maxPauseMs,
      hint_count: session.metrics.hintCount,
      composition_event_count: session.metrics.compositionEventCount,
      weak_targets: session.metrics.weakTargets.join(" "),
      wrong_keys: session.metrics.wrongKeys.join(" "),
    })),
  );
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
