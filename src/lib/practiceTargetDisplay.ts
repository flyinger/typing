export interface PracticeCursorInfo {
  nextKeyLabel: string;
  contextLabel: string;
  positionLabel: string;
  remainingUnits: number;
  errorUnits: number;
  extraUnits: number;
}

export function buildPracticeCursorInfo(targetText: string, inputText: string): PracticeCursorInfo {
  const nextChar = targetText[inputText.length];
  const errorUnits = countErrors(targetText, inputText);
  const extraUnits = Math.max(0, inputText.length - targetText.length);
  const remainingUnits = Math.max(0, targetText.length - inputText.length);
  const { line, column } = lineColumnAt(targetText, Math.min(inputText.length, targetText.length));
  const currentToken = currentTokenAt(targetText, Math.min(inputText.length, Math.max(0, targetText.length - 1)));

  return {
    nextKeyLabel: formatPracticeKey(nextChar),
    contextLabel: currentToken || "目标已完成",
    positionLabel: `${line}:${column}`,
    remainingUnits,
    errorUnits,
    extraUnits,
  };
}

export function formatPracticeKey(char: string | undefined): string {
  if (char === undefined) return "完成";
  if (char === " ") return "Space";
  if (char === "\n") return "Enter";
  if (char === "\t") return "Tab";
  return char;
}

function countErrors(targetText: string, inputText: string): number {
  let errors = 0;
  for (let index = 0; index < inputText.length; index += 1) {
    if (inputText[index] !== targetText[index]) errors += 1;
  }
  return errors;
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function currentTokenAt(text: string, index: number): string {
  if (!text) return "";
  const cursor = Math.min(index, text.length - 1);
  const isSeparator = (char: string | undefined) => char === undefined || /\s/.test(char);
  let start = cursor;
  let end = cursor;

  if (isSeparator(text[cursor])) {
    while (start > 0 && isSeparator(text[start])) start -= 1;
    if (isSeparator(text[start])) {
      start = cursor;
      while (start < text.length && isSeparator(text[start])) start += 1;
      end = start;
    } else {
      end = start;
    }
  }

  while (start > 0 && !isSeparator(text[start - 1])) start -= 1;
  while (end < text.length && !isSeparator(text[end])) end += 1;
  return text.slice(start, end);
}
