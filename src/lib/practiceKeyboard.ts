import type { TrainingMode } from "../types";

export type PracticeCompletionState = "idle" | "saving" | "saved";

export type PracticeInputKeyAction =
  | "complete-or-advance"
  | "exit"
  | "record"
  | "record-hint";

export type PracticeWindowKeyAction =
  | "complete-or-advance"
  | "exit"
  | "next"
  | "reset"
  | "stats"
  | "hint"
  | "none";

export interface PracticeKeyContext {
  key: string;
  mode: TrainingMode;
  completionState: PracticeCompletionState;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

export interface PracticeWindowKeyContext {
  key: string;
  mode: TrainingMode;
  shiftKey?: boolean;
  targetAcceptsText?: boolean;
}

export function resolvePracticeInputKeyAction({
  key,
  mode,
  completionState,
  shiftKey = false,
  ctrlKey = false,
  metaKey = false,
  isComposing = false,
}: PracticeKeyContext): PracticeInputKeyAction {
  if (key === "Escape") return "exit";

  if (key === "Enter" && !isComposing) {
    if (completionState === "saved") return "complete-or-advance";
    if (mode === "code" && (ctrlKey || metaKey)) return "complete-or-advance";
    if (mode !== "code" && !shiftKey) return "complete-or-advance";
  }

  if (mode === "wubi-code" && (key === "?" || key.toLowerCase() === "z")) {
    return "record-hint";
  }

  return "record";
}

export function resolvePracticeWindowKeyAction({
  key,
  mode,
  shiftKey = false,
  targetAcceptsText = false,
}: PracticeWindowKeyContext): PracticeWindowKeyAction {
  if (targetAcceptsText) return "none";
  if (key === "Enter" && !shiftKey) return "complete-or-advance";
  if (key === "Escape") return "exit";
  if (key === "n") return "next";
  if (key === "r") return "reset";
  if (key === "s") return "stats";
  if (key === "?" || (mode === "wubi-code" && key.toLowerCase() === "z")) return "hint";
  return "none";
}
