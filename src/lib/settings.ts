import type { AppSettings } from "../types";

export interface SettingsDraft {
  deviceName: string;
  dailyTargetMinutes: number | string;
  syncFolderHint: string;
}

export function normalizeSettingsDraft(
  current: AppSettings,
  draft: SettingsDraft,
): AppSettings {
  const deviceName = draft.deviceName.trim();
  const syncFolderHint = draft.syncFolderHint.trim();
  const minutes = Number(draft.dailyTargetMinutes);

  if (!deviceName) {
    throw new Error("设备名不能为空。");
  }
  if (!syncFolderHint) {
    throw new Error("同步目录提示不能为空。");
  }
  if (!Number.isFinite(minutes)) {
    throw new Error("每日目标必须是数字。");
  }

  return {
    ...current,
    deviceName,
    dailyTargetMinutes: clamp(Math.round(minutes), 5, 180),
    syncFolderHint,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
