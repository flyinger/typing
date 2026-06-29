import type { MaterialPack, TrainingMode, TrainingSession } from "../types";

export interface MaterialPackSummary {
  id: string;
  name: string;
  source: string;
  itemCount: number;
  modes: TrainingMode[];
  usedSessionCount: number;
  canDelete: boolean;
}

export function summarizeMaterialPacks(
  materials: MaterialPack[],
  sessions: TrainingSession[],
): MaterialPackSummary[] {
  const usage = new Map<string, number>();
  for (const session of sessions) {
    if (!session.materialId) continue;
    usage.set(session.materialId, (usage.get(session.materialId) ?? 0) + 1);
  }

  return materials.map((material) => {
    const usedSessionCount = usage.get(material.id) ?? 0;
    return {
      id: material.id,
      name: material.name,
      source: material.source,
      itemCount: material.items.length,
      modes: Array.from(new Set(material.items.map((item) => item.mode))).sort(),
      usedSessionCount,
      canDelete: material.source !== "builtin" && usedSessionCount === 0,
    };
  });
}

export function filterMaterialPacks(
  materials: MaterialPack[],
  options: {
    query: string;
    mode: "all" | TrainingMode;
    source: "all" | "builtin" | "imported";
  },
): MaterialPack[] {
  const query = options.query.trim().toLowerCase();
  return materials.filter((material) => {
    const sourceMatches =
      options.source === "all" ||
      (options.source === "builtin" && material.source === "builtin") ||
      (options.source === "imported" && material.source !== "builtin");
    const modeMatches =
      options.mode === "all" || material.items.some((item) => item.mode === options.mode);
    const queryMatches =
      !query ||
      material.name.toLowerCase().includes(query) ||
      material.description.toLowerCase().includes(query) ||
      material.source.toLowerCase().includes(query) ||
      material.items.some((item) => item.targetText.toLowerCase().includes(query));

    return sourceMatches && modeMatches && queryMatches;
  });
}
