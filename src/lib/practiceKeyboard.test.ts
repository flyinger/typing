import { describe, expect, it } from "vitest";
import {
  resolvePracticeInputKeyAction,
  resolvePracticeWindowKeyAction,
} from "./practiceKeyboard";

describe("practice keyboard interaction model", () => {
  it("keeps code Enter as newline input until the user explicitly completes", () => {
    expect(
      resolvePracticeInputKeyAction({
        key: "Enter",
        mode: "code",
        completionState: "idle",
      }),
    ).toBe("record");
    expect(
      resolvePracticeInputKeyAction({
        key: "Enter",
        mode: "code",
        completionState: "idle",
        ctrlKey: true,
      }),
    ).toBe("complete-or-advance");
    expect(
      resolvePracticeInputKeyAction({
        key: "Enter",
        mode: "code",
        completionState: "idle",
        metaKey: true,
      }),
    ).toBe("complete-or-advance");
  });

  it("uses Enter as the fast complete and next key outside code composition", () => {
    expect(
      resolvePracticeInputKeyAction({
        key: "Enter",
        mode: "english",
        completionState: "idle",
      }),
    ).toBe("complete-or-advance");
    expect(
      resolvePracticeInputKeyAction({
        key: "Enter",
        mode: "english",
        completionState: "idle",
        shiftKey: true,
      }),
    ).toBe("record");
    expect(
      resolvePracticeInputKeyAction({
        key: "Enter",
        mode: "chinese-real",
        completionState: "idle",
        isComposing: true,
      }),
    ).toBe("record");
    expect(
      resolvePracticeInputKeyAction({
        key: "Enter",
        mode: "vim",
        completionState: "saved",
      }),
    ).toBe("complete-or-advance");
  });

  it("keeps wubi hints and escape predictable in the input area", () => {
    expect(
      resolvePracticeInputKeyAction({
        key: "z",
        mode: "wubi-code",
        completionState: "idle",
      }),
    ).toBe("record-hint");
    expect(
      resolvePracticeInputKeyAction({
        key: "?",
        mode: "wubi-code",
        completionState: "idle",
      }),
    ).toBe("record-hint");
    expect(
      resolvePracticeInputKeyAction({
        key: "Escape",
        mode: "english",
        completionState: "idle",
      }),
    ).toBe("exit");
  });

  it("routes global shortcuts only when focus is not in a text field", () => {
    expect(
      resolvePracticeWindowKeyAction({
        key: "n",
        mode: "english",
        targetAcceptsText: true,
      }),
    ).toBe("none");
    expect(resolvePracticeWindowKeyAction({ key: "n", mode: "english" })).toBe("next");
    expect(resolvePracticeWindowKeyAction({ key: "r", mode: "english" })).toBe("reset");
    expect(resolvePracticeWindowKeyAction({ key: "s", mode: "english" })).toBe("stats");
    expect(resolvePracticeWindowKeyAction({ key: "Escape", mode: "english" })).toBe("exit");
    expect(resolvePracticeWindowKeyAction({ key: "Enter", mode: "english" })).toBe("complete-or-advance");
    expect(resolvePracticeWindowKeyAction({ key: "?", mode: "english" })).toBe("hint");
    expect(resolvePracticeWindowKeyAction({ key: "z", mode: "wubi-code" })).toBe("hint");
  });
});
