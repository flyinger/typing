import { describe, expect, it } from "vitest";
import type { ExerciseItem } from "../types";
import {
  buildPracticeLiveStats,
  isPracticeInputComplete,
  normalizePracticeInput,
} from "./practiceLiveStats";

const baseItem: ExerciseItem = {
  id: "item-1",
  mode: "english",
  prompt: "",
  targetText: "append only event log",
  category: "test",
  tags: [],
  difficulty: 2,
  source: "test",
  contentHash: "hash",
};

const counters = {
  backspaces: 2,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  hintCount: 0,
  pasteEventCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
};

describe("practice live stats", () => {
  it("treats accepted wubi codes as complete case-insensitively", () => {
    const item: ExerciseItem = {
      ...baseItem,
      mode: "wubi-code",
      targetText: "中",
      expectedCodes: ["khk", "KH"],
    };

    expect(isPracticeInputComplete(item, " KHK ")).toBe(true);
    expect(isPracticeInputComplete(item, "khx")).toBe(false);
  });

  it("keeps code leading indentation while ignoring trailing whitespace", () => {
    const item: ExerciseItem = {
      ...baseItem,
      mode: "code",
      targetText: "  const speed = 80;",
    };

    expect(normalizePracticeInput(item, "  const speed = 80;  ")).toBe("  const speed = 80;");
    expect(isPracticeInputComplete(item, "const speed = 80;")).toBe(false);
    expect(isPracticeInputComplete(item, "  const speed = 80;\n")).toBe(true);
  });

  it("builds lightweight live speed, accuracy, progress, and backspace stats", () => {
    const stats = buildPracticeLiveStats({
      item: baseItem,
      inputText: "append only",
      elapsedMs: 30_000,
      counters,
    });

    expect(stats.charsPerMinute).toBe(22);
    expect(stats.accuracy).toBe(52.4);
    expect(stats.progressPercent).toBe(52);
    expect(stats.backspaces).toBe(2);
    expect(stats.backspacePer100Chars).toBe(18.2);
    expect(stats.status).toBe("typing");
  });

  it("marks exact text completion for auto-advance decisions", () => {
    const stats = buildPracticeLiveStats({
      item: baseItem,
      inputText: "append only event log",
      elapsedMs: 60_000,
      counters: { ...counters, backspaces: 0 },
    });

    expect(stats.status).toBe("complete");
    expect(isPracticeInputComplete(baseItem, "append only event log")).toBe(true);
  });
});
