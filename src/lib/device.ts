import { createId } from "./id";

const DEVICE_KEY = "typinglab.deviceId";

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) {
    return existing;
  }
  const deviceId = createId("device");
  localStorage.setItem(DEVICE_KEY, deviceId);
  return deviceId;
}

export function detectDeviceName(): string {
  const platform = navigator.platform || "unknown";
  const ua = navigator.userAgent.includes("Linux")
    ? "Ubuntu/Linux"
    : navigator.userAgent.includes("Mac")
      ? "macOS"
      : "Browser";
  return `${ua} · ${platform}`;
}
