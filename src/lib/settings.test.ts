import { describe, expect, it } from "vitest";
import type { AppSettings } from "../types";
import { normalizeSettingsDraft } from "./settings";

const current: AppSettings = {
  id: "main",
  deviceId: "device_1",
  deviceName: "macOS",
  dailyTargetMinutes: 20,
  syncFolderHint: "TypingLab/",
  theme: "dark",
  lastSyncExportAt: "2026-06-25T00:00:00.000Z",
};

describe("normalizeSettingsDraft", () => {
  it("trims text fields and clamps daily target", () => {
    expect(
      normalizeSettingsDraft(current, {
        deviceName: " Mac Studio ",
        dailyTargetMinutes: 300,
        syncFolderHint: " ~/Sync/TypingLab ",
      }),
    ).toMatchObject({
      deviceName: "Mac Studio",
      dailyTargetMinutes: 180,
      syncFolderHint: "~/Sync/TypingLab",
      lastSyncExportAt: "2026-06-25T00:00:00.000Z",
    });
  });

  it("rejects empty required fields and non-number target", () => {
    expect(() =>
      normalizeSettingsDraft(current, {
        deviceName: "",
        dailyTargetMinutes: 20,
        syncFolderHint: "TypingLab/",
      }),
    ).toThrow("设备名不能为空");

    expect(() =>
      normalizeSettingsDraft(current, {
        deviceName: "Ubuntu",
        dailyTargetMinutes: "abc",
        syncFolderHint: "TypingLab/",
      }),
    ).toThrow("每日目标必须是数字");
  });
});
