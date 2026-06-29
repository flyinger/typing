import { describe, expect, it } from "vitest";
import { sampleMaterialPacks } from "./sampleMaterials";
import { buildFoundationMaterialReadiness } from "../lib/materialReadiness";
import { buildSyncDataFingerprint } from "../lib/syncFingerprint";

describe("sampleMaterialPacks", () => {
  it("keeps built-in ids and content hashes stable across calls", async () => {
    const first = await sampleMaterialPacks();
    const second = await sampleMaterialPacks();

    expect(first[0].id).toBe(second[0].id);
    expect(first[0].contentHash).toBe(second[0].contentHash);
    expect(first[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(first[0].updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(first).toEqual(second);
    expect(first[0].items.map((item) => item.id)).toEqual(
      second[0].items.map((item) => item.id),
    );
  });

  it("keeps sync fingerprints stable when only built-in material is present", async () => {
    const first = await sampleMaterialPacks();
    const second = await sampleMaterialPacks();

    expect(buildSyncDataFingerprint([], [], first)).toEqual(
      buildSyncDataFingerprint([], [], second),
    );
  });

  it("includes enough english code and vim items for the foundation stage", async () => {
    const [pack] = await sampleMaterialPacks();
    const countByMode = new Map<string, number>();

    for (const item of pack.items) {
      countByMode.set(item.mode, (countByMode.get(item.mode) ?? 0) + 1);
    }

    expect(countByMode.get("english")).toBeGreaterThanOrEqual(20);
    expect(countByMode.get("code")).toBeGreaterThanOrEqual(20);
    expect(countByMode.get("vim")).toBeGreaterThanOrEqual(12);
  });

  it("ships enough foundation-capable english and code material", async () => {
    const [pack] = await sampleMaterialPacks();
    const report = buildFoundationMaterialReadiness(pack.items);

    expect(report.ready).toBe(true);
    expect(report.modes).toEqual([
      expect.objectContaining({
        mode: "english",
        effectiveItems: expect.any(Number),
        comfortItems: expect.any(Number),
        missingEffectiveItems: 0,
        status: "ready",
      }),
      expect.objectContaining({
        mode: "code",
        effectiveItems: expect.any(Number),
        comfortItems: expect.any(Number),
        missingEffectiveItems: 0,
        status: "ready",
      }),
    ]);
  });

  it("includes enough wubi and real chinese starter material", async () => {
    const [pack] = await sampleMaterialPacks();
    const countByMode = new Map<string, number>();

    for (const item of pack.items) {
      countByMode.set(item.mode, (countByMode.get(item.mode) ?? 0) + 1);
    }

    expect(countByMode.get("wubi-code")).toBeGreaterThanOrEqual(50);
    expect(countByMode.get("chinese-real")).toBeGreaterThanOrEqual(16);
    expect(pack.items.find((item) => item.targetText === "我")?.expectedCodes).toContain("q");
    expect(pack.items.find((item) => item.targetText === "中")?.expectedCodes).toContain("k");
  });

  it("includes root-key, command, and privacy-aware sync drills", async () => {
    const [pack] = await sampleMaterialPacks();

    expect(pack.items.filter((item) => item.category === "字根键位")).toHaveLength(25);
    expect(pack.items.some((item) => item.targetText === "git pull --ff-only origin main")).toBe(true);
    expect(pack.items.some((item) => item.targetText.includes("public repository"))).toBe(true);
    expect(pack.items.some((item) => item.tags.includes("robotics"))).toBe(true);
  });

  it("includes longer stage-two paragraph and multiline code drills", async () => {
    const [pack] = await sampleMaterialPacks();

    expect(
      pack.items.some(
        (item) =>
          item.mode === "english" &&
          item.category === "英文连续输入" &&
          item.targetText.length > 140,
      ),
    ).toBe(true);
    expect(
      pack.items.some(
        (item) =>
          item.mode === "code" &&
          item.category === "代码连续片段" &&
          item.targetText.includes("\n  const seen = new Set<string>();\n"),
      ),
    ).toBe(true);
  });
});
