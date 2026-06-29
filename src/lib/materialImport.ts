import type { ExerciseItem, MaterialPack, TrainingMode } from "../types";
import { createId } from "./id";
import { hashText, stableStringify } from "./hash";

export interface ParsedTextMaterialLine {
  targetText: string;
  expectedCodes?: string[];
}

export interface TextMaterialPackDraft {
  name: string;
  content: string;
  mode: TrainingMode;
  source: string;
  description?: string;
  limit?: number;
}

export function parseTextMaterialLine(
  line: string,
  mode: TrainingMode,
): ParsedTextMaterialLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (mode !== "wubi-code") {
    return { targetText: trimmed };
  }

  const tabParts = trimmed.split(/\t+/).map((part) => part.trim()).filter(Boolean);
  if (tabParts.length >= 2) {
    const expectedCodes = splitCodes(tabParts.slice(1).join(" "));
    if (expectedCodes.length === 0) return null;
    return {
      targetText: tabParts[0],
      expectedCodes,
    };
  }

  const commaParts = trimmed.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const expectedCodes = splitCodes(commaParts.slice(1).join(" "));
    if (expectedCodes.length === 0) return null;
    return {
      targetText: commaParts[0],
      expectedCodes,
    };
  }

  return null;
}

function splitCodes(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s/|]+/)
        .map((code) => code.trim().toLowerCase())
        .filter((code) => /^[a-z]{1,8}$/.test(code)),
    ),
  );
}

export async function createMaterialPackFromText(
  draft: TextMaterialPackDraft,
): Promise<MaterialPack> {
  const name = draft.name.trim();
  const content = draft.content.trim();
  if (!name) {
    throw new Error("材料包名称不能为空。");
  }
  if (!content) {
    throw new Error("材料内容不能为空。");
  }

  const parsedLines = content
    .split(/\r?\n/)
    .map((line) => parseTextMaterialLine(line, draft.mode))
    .filter((line): line is ParsedTextMaterialLine => line !== null)
    .slice(0, draft.limit ?? 1000);

  if (parsedLines.length === 0) {
    throw new Error(
      draft.mode === "wubi-code"
        ? "没有可导入的有效五笔材料行：每行需要目标字词和至少一个有效字母编码。"
        : "没有可导入的有效材料行。",
    );
  }

  const now = new Date().toISOString();
  const source = draft.source.trim() || "manual";
  const items: ExerciseItem[] = [];

  for (const [index, line] of parsedLines.entries()) {
    const raw = { mode: draft.mode, line, source, index };
    items.push({
      id: createId("item"),
      mode: draft.mode,
      prompt: draft.mode === "wubi-code" ? "输入五笔编码" : "精确输入目标文本",
      targetText: line.targetText,
      expectedCodes: line.expectedCodes,
      category: getModeCategory(draft.mode),
      tags: ["imported", draft.mode],
      difficulty: 2,
      source,
      contentHash: await hashText(stableStringify(raw)),
    });
  }

  return {
    id: createId("pack"),
    name,
    description:
      draft.description?.trim() ||
      `从文本创建的 ${getModeCategory(draft.mode)} 材料，共 ${items.length} 条。`,
    version: 1,
    source,
    createdAt: now,
    updatedAt: now,
    contentHash: await hashText(
      stableStringify({
        name,
        source,
        mode: draft.mode,
        lines: parsedLines,
      }),
    ),
    items,
  };
}

function getModeCategory(mode: TrainingMode): string {
  switch (mode) {
    case "wubi-code":
      return "五笔编码";
    case "chinese-real":
      return "中文真实输入";
    case "english":
      return "英文/术语";
    case "code":
      return "代码符号";
    case "vim":
      return "Vim motion kata";
  }
}
