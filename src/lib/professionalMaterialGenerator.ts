import type { TrainingMode } from "../types";

export interface ProfessionalMaterialDraft {
  mode: TrainingMode;
  name: string;
  content: string;
  itemCount: number;
  examples: string[];
}

export interface ProfessionalMaterialGeneration {
  drafts: ProfessionalMaterialDraft[];
  sourceLength: number;
  candidateCount: number;
}

interface Candidate {
  mode: TrainingMode;
  text: string;
}

const generatedModes: TrainingMode[] = ["chinese-real", "english", "code", "vim"];
const maxItemsPerMode = 16;

export function generateProfessionalMaterialDrafts(
  source: string,
  baseName = "专业材料",
): ProfessionalMaterialGeneration {
  const normalized = normalizeSource(source);
  if (!normalized) {
    return { drafts: [], sourceLength: 0, candidateCount: 0 };
  }

  const candidates = [
    ...extractChineseCandidates(normalized),
    ...extractEnglishCandidates(normalized),
    ...extractCodeCandidates(normalized),
    ...extractVimCandidates(normalized),
  ];
  const drafts = generatedModes
    .map((mode) => {
      const items = uniqueCandidates(candidates.filter((candidate) => candidate.mode === mode))
        .slice(0, maxItemsPerMode)
        .map((candidate) => candidate.text);
      if (items.length === 0) return null;
      return {
        mode,
        name: `${cleanBaseName(baseName)} · ${modeDraftLabel(mode)}`,
        content: `${items.join("\n")}\n`,
        itemCount: items.length,
        examples: items.slice(0, 3),
      };
    })
    .filter((draft): draft is ProfessionalMaterialDraft => draft !== null);

  return {
    drafts,
    sourceLength: normalized.length,
    candidateCount: candidates.length,
  };
}

function normalizeSource(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractChineseCandidates(source: string): Candidate[] {
  const sentenceParts = source
    .replace(/\n+/g, " ")
    .split(/(?<=[。！？!?；;])|\n+/)
    .map(cleanLine)
    .filter((line) => isChineseText(line) && line.length >= 8 && line.length <= 90);

  const shortTerms = source
    .split(/[，,。！？!?；;：:\n\t()[\]{}"'`<>|/\\]+/)
    .map(cleanLine)
    .filter((line) => isChineseText(line) && line.length >= 2 && line.length <= 16)
    .filter((line) => !looksLikeCode(line));

  return [...sentenceParts, ...shortTerms].map((text) => ({
    mode: "chinese-real",
    text,
  }));
}

function extractEnglishCandidates(source: string): Candidate[] {
  const fromLines = source
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => isEnglishPracticeText(line));

  const fromSentences = source
    .split(/[.!?\n]+/)
    .map(cleanLine)
    .filter((line) => isEnglishPracticeText(line));

  return [...fromLines, ...fromSentences].map((text) => ({
    mode: "english",
    text,
  }));
}

function extractCodeCandidates(source: string): Candidate[] {
  return source
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => line.length >= 10 && line.length <= 140)
    .filter((line) => !looksLikeVimOrCommand(line))
    .filter(looksLikeCode)
    .map((text) => ({
      mode: "code",
      text,
    }));
}

function extractVimCandidates(source: string): Candidate[] {
  return source
    .split(/\n+/)
    .map(cleanLine)
    .filter((line) => line.length >= 3 && line.length <= 90)
    .filter(looksLikeVimOrCommand)
    .map((text) => ({
      mode: "vim",
      text,
    }));
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.mode}:${canonicalCandidateText(candidate.text)}`;
    const contained = unique.some(
      (existing) =>
        existing.mode === candidate.mode &&
        isContainedDuplicate(existing.text, candidate.text),
    );
    if (seen.has(key) || contained) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function canonicalCandidateText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[。！？!?；;.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isContainedDuplicate(left: string, right: string): boolean {
  const normalizedLeft = canonicalCandidateText(left);
  const normalizedRight = canonicalCandidateText(right);
  if (normalizedLeft === normalizedRight) return true;
  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length > normalizedRight.length ? normalizedLeft : normalizedRight;
  return shorter.length >= 4 && longer.includes(shorter);
}

function cleanLine(line: string): string {
  return line
    .replace(/^[-*+]\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^`{3,}\w*\s*/, "")
    .replace(/`{3,}$/g, "")
    .trim();
}

function isChineseText(line: string): boolean {
  return /[\u4e00-\u9fff]/.test(line) && !/^\s*name:\s*/i.test(line);
}

function isEnglishPracticeText(line: string): boolean {
  if (line.length < 18 || line.length > 120) return false;
  if (isChineseText(line) || looksLikeCode(line) || looksLikeVimOrCommand(line)) return false;
  const words = line.match(/[A-Za-z][A-Za-z0-9_+#.-]*/g) ?? [];
  if (words.length < 4) return false;
  const letters = words.join("").length;
  return letters / Math.max(1, line.length) > 0.55;
}

function looksLikeCode(line: string): boolean {
  return (
    /\b(const|let|var|function|return|class|interface|type|import|export|await|async|if|for|while|def|public|private)\b/.test(line) ||
    /[{}()[\];=<>]/.test(line) ||
    /=>|::|\.\w+\(/.test(line)
  );
}

function looksLikeVimOrCommand(line: string): boolean {
  return (
    /^:[^\s]+/.test(line) ||
    /<Enter>|<Esc>/i.test(line) ||
    /\b[dcvy][ia]?[w"'{}()[\]]\b/.test(line) ||
    /^(git|npm|pnpm|yarn|rg|fd|cd|ssh|docker|kubectl|make|cargo|python|node)\b/.test(line)
  );
}

function cleanBaseName(name: string): string {
  return name.trim() || "专业材料";
}

function modeDraftLabel(mode: TrainingMode): string {
  switch (mode) {
    case "chinese-real":
      return "中文真实输入";
    case "english":
      return "英文术语";
    case "code":
      return "代码片段";
    case "vim":
      return "Vim/命令";
    case "wubi-code":
      return "五笔编码";
  }
}
