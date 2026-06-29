import { describe, expect, it } from "vitest";
import type {
  InputEventLog,
  MaterialPack,
  SessionMetrics,
  TrainingSession,
} from "../types";
import {
  buildKeyboardHeatmap,
  buildPausePositionHotspots,
  buildTrainingCalendarHeatmap,
  buildWubiRootHeatmap,
} from "./heatmaps";

const baseMetrics: SessionMetrics = {
  charsPerMinute: 80,
  accuracy: 96,
  backspaces: 1,
  backspacePer100Chars: 5,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  correctUnits: 4,
  totalUnits: 4,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
  weakTargets: [],
  errorPositions: [],
};

function makeSession(
  id: string,
  overrides: Partial<TrainingSession> = {},
  metricOverrides: Partial<SessionMetrics> = {},
): TrainingSession {
  return {
    id,
    deviceId: "device-1",
    mode: "english",
    itemId: "item-1",
    targetText: "abcdef",
    inputText: "abcdef",
    startedAt: "2026-06-26T08:00:00.000Z",
    endedAt: "2026-06-26T08:02:00.000Z",
    durationMs: 120000,
    metrics: { ...baseMetrics, ...metricOverrides },
    ...overrides,
  };
}

describe("analytics heatmaps", () => {
  it("builds a local-day activity heatmap", () => {
    const days = buildTrainingCalendarHeatmap(
      [makeSession("s1", { durationMs: 10 * 60000 })],
      2,
      new Date("2026-06-27T10:00:00.000Z"),
    );

    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({
      date: "2026-06-26",
      sessions: 1,
      minutes: 10,
      level: 2,
    });
    expect(days[1]).toMatchObject({
      date: "2026-06-27",
      sessions: 0,
      level: 0,
    });
  });

  it("counts wrong keyboard keys into stable keyboard rows", () => {
    const rows = buildKeyboardHeatmap([
      makeSession("s1", {}, { wrongKeys: ["x", "X", "j", "Enter"] }),
    ]);
    const cells = rows.flat();

    expect(cells.find((cell) => cell.key === "x")).toMatchObject({ count: 2, level: 4 });
    expect(cells.find((cell) => cell.key === "j")).toMatchObject({ count: 1 });
    expect(cells.find((cell) => cell.key === "q")).toMatchObject({ count: 0, level: 0 });
  });

  it("maps weak wubi sessions back to root keys from material codes", () => {
    const material: MaterialPack = {
      id: "pack-wubi",
      name: "五笔材料",
      description: "test",
      version: 1,
      source: "test",
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
      contentHash: "hash",
      items: [
        {
          id: "wubi-wo",
          mode: "wubi-code",
          prompt: "输入编码",
          targetText: "我",
          expectedCodes: ["trnt"],
          category: "单字",
          tags: ["wubi"],
          difficulty: 1,
          source: "test",
          contentHash: "item-hash",
        },
      ],
    };
    const rows = buildWubiRootHeatmap(
      [
        makeSession(
          "s1",
          { mode: "wubi-code", itemId: "wubi-wo", targetText: "我", inputText: "tx" },
          { accuracy: 50, hintCount: 1, wrongKeys: ["x"], errorPositions: [1] },
        ),
      ],
      [material],
    );
    const cells = rows.flat();

    expect(cells.find((cell) => cell.key === "t")).toMatchObject({ count: 4 });
    expect(cells.find((cell) => cell.key === "r")).toMatchObject({ count: 4 });
    expect(cells.find((cell) => cell.key === "n")).toMatchObject({ count: 4 });
  });

  it("builds long-pause hotspots from append-only events", () => {
    const session = makeSession("s1");
    const event: InputEventLog = {
      eventId: "event-1",
      sessionId: "s1",
      deviceId: "device-1",
      type: "long_pause",
      occurredAt: "2026-06-26T08:00:03.000Z",
      sequence: 2,
      payload: {
        pauseMs: 2300,
        position: 2,
      },
    };

    expect(buildPausePositionHotspots([session], [event])).toEqual([
      expect.objectContaining({
        label: "c",
        context: "ab[c]def",
        count: 1,
        detail: "english · 最长停顿 2300ms",
      }),
    ]);
  });
});
