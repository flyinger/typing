export type PracticeDiscardAction = "exit" | "next" | "reset" | "mode";

export function hasUnsavedPracticeInput({
  started,
  inputText,
  completionState,
}: {
  started: boolean;
  inputText: string;
  completionState: "idle" | "saving" | "saved";
}): boolean {
  return started && completionState === "idle" && inputText.trim().length > 0;
}

export function practiceDiscardMessage(action: PracticeDiscardAction): string {
  const actionText = {
    exit: "退出训练",
    next: "进入下一组",
    reset: "重练当前组",
    mode: "切换训练模式",
  } satisfies Record<PracticeDiscardAction, string>;

  return `当前训练尚未完成，${actionText[action]}会丢弃本轮输入。是否继续？`;
}
