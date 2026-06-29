import { describe, expect, it } from "vitest";
import type { TrainingProtocol } from "./trainingPlan";
import { buildManualPracticeModeWarning } from "./practiceModeWarning";

const foundationProtocol: TrainingProtocol = {
  title: "第 1 阶段执行协议：英文/代码速度底座",
  summary: "",
  primaryMode: "english",
  exitCriteria: [],
  guardrails: [],
  reviewChecklist: [],
};

describe("buildManualPracticeModeWarning", () => {
  it("does not warn for queued practice or the protocol primary mode", () => {
    expect(buildManualPracticeModeWarning("english", foundationProtocol, false)).toBeNull();
    expect(buildManualPracticeModeWarning("wubi-code", foundationProtocol, true)).toBeNull();
  });

  it("warns when manually practicing wubi before the foundation is ready", () => {
    const warning = buildManualPracticeModeWarning("wubi-code", foundationProtocol, false);

    expect(warning).toMatchObject({
      title: "当前不是五笔主训练阶段",
      primaryMode: "english",
      selectedMode: "wubi-code",
    });
    expect(warning?.detail).toContain("不要用它替代英文/代码 80 CPM 底座训练");
  });

  it("warns for maintenance practice after the main line changes", () => {
    const wubiProtocol: TrainingProtocol = {
      ...foundationProtocol,
      title: "第 2 阶段执行协议：五笔编码准确",
      primaryMode: "wubi-code",
    };
    const warning = buildManualPracticeModeWarning("english", wubiProtocol, false);

    expect(warning).toMatchObject({
      title: "当前模式不是今日主线",
      primaryMode: "wubi-code",
      selectedMode: "english",
    });
    expect(warning?.detail).toContain("临时加练或维护");
  });
});
