export function createId(prefix = "id"): string {
  const random = crypto.getRandomValues(new Uint32Array(4));
  return `${prefix}_${Date.now().toString(36)}_${Array.from(random)
    .map((part) => part.toString(36))
    .join("")}`;
}

export function createEventId(deviceId: string, sessionId: string, sequence: number): string {
  return `${deviceId}:${sessionId}:${sequence}`;
}
