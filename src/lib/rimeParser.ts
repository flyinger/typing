import type { ExerciseItem, MaterialPack, TrainingMode } from "../types";
import { createId } from "./id";
import { hashText, stableStringify } from "./hash";

export interface ParsedRimeEntry {
  text: string;
  codes: string[];
  weight?: number;
}

export function parseRimeDictionary(content: string): ParsedRimeEntry[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === "...");
  const dataLines = startIndex >= 0 ? lines.slice(startIndex + 1) : lines;
  const entries = new Map<string, ParsedRimeEntry>();

  for (const rawLine of dataLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\t+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) continue;

    const [text, code, weightRaw] = parts;
    const normalizedCode = code.toLowerCase();
    if (!text || !/^[a-z]{1,8}$/.test(normalizedCode)) continue;

    const key = text;
    const existing = entries.get(key);
    const weight = weightRaw ? Number(weightRaw) : undefined;
    if (existing) {
      if (!existing.codes.includes(normalizedCode)) {
        existing.codes.push(normalizedCode);
      }
      existing.weight = Math.max(existing.weight ?? 0, Number.isFinite(weight) ? weight! : 0);
    } else {
      entries.set(key, {
        text,
        codes: [normalizedCode],
        weight: Number.isFinite(weight) ? weight : undefined,
      });
    }
  }

  return Array.from(entries.values());
}

export async function createMaterialPackFromRime(
  name: string,
  source: string,
  content: string,
  limit = 1500,
): Promise<MaterialPack> {
  const entries = parseRimeDictionary(content)
    .sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0))
    .slice(0, limit);

  if (entries.length === 0) {
    throw new Error("没有可导入的有效 Rime 五笔词条：请确认词库正文使用“字词<Tab>编码”格式。");
  }

  const items: ExerciseItem[] = [];
  for (const entry of entries) {
    const mode: TrainingMode = "wubi-code";
    const hash = await hashText(stableStringify(entry));
    items.push({
      id: createId("item"),
      mode,
      prompt: "输入五笔编码",
      targetText: entry.text,
      expectedCodes: entry.codes,
      category: entry.text.length === 1 ? "五笔单字" : "五笔词组",
      tags: ["rime", "wubi86", entry.text.length === 1 ? "single" : "phrase"],
      difficulty: entry.text.length === 1 ? 2 : 3,
      source,
      explanation: `编码：${entry.codes.join(" / ")}`,
      contentHash: hash,
    });
  }

  const now = new Date().toISOString();
  const contentHash = await hashText(stableStringify({ name, source, items }));
  return {
    id: createId("pack"),
    name,
    description: `从 Rime 词库导入的五笔训练材料，共 ${items.length} 条。`,
    version: 1,
    source,
    createdAt: now,
    updatedAt: now,
    contentHash,
    items,
  };
}
