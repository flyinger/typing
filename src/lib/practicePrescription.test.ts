import { describe, expect, it } from "vitest";
import type { SessionMetrics, TrainingMode, TrainingSession } from "../types";
import { buildPracticePrescription } from "./practicePrescription";

const metrics: SessionMetrics = {
  charsPerMinute: 85,
  accuracy: 98,
  backspaces: 1,
  backspacePer100Chars: 4,
  pauseCountOver1500Ms: 0,
  maxPauseMs: 0,
  correctUnits: 10,
  totalUnits: 10,
  hintUsed: false,
  hintCount: 0,
  compositionEventCount: 0,
  wrongKeys: [],
  weakTargets: [],
  errorPositions: [],
};

function session(mode: TrainingMode, overrides: Partial<SessionMetrics> = {}): TrainingSession {
  return {
    id: `${mode}-1`,
    deviceId: "device",
    mode,
    itemId: "item-1",
    targetText: "target hit",
    inputText: "target hit",
    startedAt: "2026-06-26T08:00:00.000Z",
    endedAt: "2026-06-26T08:01:00.000Z",
    durationMs: 60000,
    metrics: {
      ...metrics,
      ...overrides,
    },
  };
}

describe("buildPracticePrescription", () => {
  it("prioritizes accuracy repair before speed", () => {
    const prescription = buildPracticePrescription(session("english", { accuracy: 90, charsPerMinute: 120 }));

    expect(prescription).toMatchObject({
      severity: "repair",
      decision: "retry",
      canAdvanceQueue: false,
      title: "先修准确率",
    });
    expect(prescription.queueAdvice).toContain("不要推进队列");
    expect(prescription.guardrail).toContain("96%");
  });

  it("turns hint usage into a no-hint retry prescription", () => {
    const prescription = buildPracticePrescription(session("wubi-code", { hintCount: 2, hintUsed: true }));

    expect(prescription).toMatchObject({
      severity: "repair",
      decision: "retry",
      canAdvanceQueue: false,
      title: "减少提示依赖",
    });
    expect(prescription.nextAction).toContain("无提示重练");
    expect(prescription.guardrail).toContain("z/?");
  });

  it("does not credit hinted english or code rounds to the foundation window", () => {
    const prescription = buildPracticePrescription(
      session("english", { hintCount: 1, hintUsed: true, charsPerMinute: 90, accuracy: 98 }),
    );

    expect(prescription).toMatchObject({
      severity: "repair",
      decision: "retry",
      canAdvanceQueue: false,
      foundationCredit: {
        credited: false,
        label: "不计入底座",
      },
      title: "减少提示依赖",
    });
    expect(prescription.foundationCredit?.detail).toContain("本轮使用 1 次提示");
  });

  it("uses mode-specific backspace targets", () => {
    const prescription = buildPracticePrescription(session("code", { backspacePer100Chars: 13 }));

    expect(prescription).toMatchObject({
      severity: "attention",
      decision: "protect",
      canAdvanceQueue: false,
      title: "降低退格率",
    });
    expect(prescription.diagnosis).toContain("12/100");
  });

  it("recommends speed work only after stability is acceptable", () => {
    const prescription = buildPracticePrescription(session("english", { charsPerMinute: 72, accuracy: 97 }));

    expect(prescription).toMatchObject({
      severity: "attention",
      decision: "protect",
      canAdvanceQueue: false,
      foundationCredit: {
        credited: true,
        label: "计入底座",
      },
      title: "在稳定基础上提速",
    });
    expect(prescription.queueAdvice).toContain("80 CPM");
    expect(prescription.foundationCredit?.detail).toContain("20 轮稳定窗口");
  });

  it("marks short english or code rounds as warmup instead of foundation progress", () => {
    const prescription = buildPracticePrescription({
      ...session("english", { charsPerMinute: 180, accuracy: 99 }),
      durationMs: 5000,
    });

    expect(prescription).toMatchObject({
      severity: "attention",
      decision: "continue",
      decisionLabel: "热身通过",
      canAdvanceQueue: true,
      foundationCredit: {
        credited: false,
        label: "不计入底座",
      },
      title: "不计入底座",
    });
    expect(prescription.diagnosis).toContain("低于有效样本要求 12 秒");
    expect(prescription.queueAdvice).toContain("不会计入英文/代码 5 轮基线");
    expect(prescription.foundationCredit?.detail).toContain("不会计入英文/代码底座");
  });

  it("marks rounds with too little actual input as warmup instead of foundation progress", () => {
    const prescription = buildPracticePrescription({
      ...session("english", { charsPerMinute: 180, accuracy: 99 }),
      inputText: "short",
    });

    expect(prescription).toMatchObject({
      severity: "attention",
      decision: "continue",
      decisionLabel: "热身通过",
      canAdvanceQueue: true,
      foundationCredit: {
        credited: false,
        label: "不计入底座",
      },
      title: "不计入底座",
    });
    expect(prescription.diagnosis).toContain("本轮实际只输入 5 个单位");
    expect(prescription.guardrail).toContain("材料和实际输入都至少 10 个单位");
  });

  it("marks pasted english or code rounds as warmup instead of foundation progress", () => {
    const prescription = buildPracticePrescription(
      session("code", { charsPerMinute: 160, accuracy: 99, pasteEventCount: 1 }),
    );

    expect(prescription).toMatchObject({
      severity: "attention",
      decision: "continue",
      decisionLabel: "热身通过",
      canAdvanceQueue: true,
      foundationCredit: {
        credited: false,
        label: "不计入底座",
      },
      title: "不计入底座",
    });
    expect(prescription.diagnosis).toContain("发生 1 次粘贴或大段突增输入");
  });

  it("includes the next recommendation in stable sessions", () => {
    const prescription = buildPracticePrescription(session("code"), {
      mode: "code",
      targetText: "const targetCpm = 80;",
      reasons: ["间隔复习", "保持手感"],
    });

    expect(prescription).toMatchObject({
      severity: "stable",
      decision: "continue",
      canAdvanceQueue: true,
      title: "本轮稳定",
    });
    expect(prescription.nextAction).toContain("const targetCpm = 80;");
    expect(prescription.nextAction).toContain("间隔复习 / 保持手感");
  });

  it("does not show foundation credit for non-foundation modes", () => {
    const prescription = buildPracticePrescription(session("wubi-code"));

    expect(prescription.foundationCredit).toBeUndefined();
  });
});
