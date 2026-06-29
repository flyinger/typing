import { describe, expect, it } from "vitest";
import { hasUnsavedPracticeInput, practiceDiscardMessage } from "./practiceExitGuard";

describe("practice exit guard", () => {
  it("detects unfinished input that would be lost", () => {
    expect(
      hasUnsavedPracticeInput({
        started: true,
        inputText: "unfinished typing",
        completionState: "idle",
      }),
    ).toBe(true);
  });

  it("does not warn before input starts, after save, or while saving", () => {
    expect(
      hasUnsavedPracticeInput({
        started: false,
        inputText: "draft",
        completionState: "idle",
      }),
    ).toBe(false);
    expect(
      hasUnsavedPracticeInput({
        started: true,
        inputText: "draft",
        completionState: "saved",
      }),
    ).toBe(false);
    expect(
      hasUnsavedPracticeInput({
        started: true,
        inputText: "draft",
        completionState: "saving",
      }),
    ).toBe(false);
  });

  it("describes the destructive action", () => {
    expect(practiceDiscardMessage("mode")).toContain("切换训练模式");
    expect(practiceDiscardMessage("next")).toContain("进入下一组");
  });
});
