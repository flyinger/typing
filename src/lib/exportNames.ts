import type { SyncDataFingerprint } from "../types";

export function syncPackageFilename(exportedAt: string, fingerprint?: SyncDataFingerprint): string {
  return withFingerprint("typinglab-sync", exportedAt, fingerprint, "json");
}

export function syncFolderManifestFilename(exportedAt: string, fingerprint?: SyncDataFingerprint): string {
  return withFingerprint("typinglab-sync-folder", exportedAt, fingerprint, "json");
}

export function eventsJsonlFilename(exportedAt: string | Date = new Date()): string {
  return `typinglab-events-${compactTimestamp(exportedAt)}.jsonl`;
}

export function sessionsCsvFilename(exportedAt: string | Date = new Date()): string {
  return `typinglab-sessions-${compactTimestamp(exportedAt)}.csv`;
}

export function weeklyReviewMarkdownFilename(periodEnd: string | Date = new Date()): string {
  return `typinglab-weekly-review-${dateStamp(periodEnd)}.md`;
}

export function compactTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown-time";
  }
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function dateStamp(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown-date";
  }
  return date.toISOString().slice(0, 10);
}

function withFingerprint(
  prefix: string,
  exportedAt: string,
  fingerprint: SyncDataFingerprint | undefined,
  extension: string,
): string {
  const fingerprintPart = fingerprint?.shortValue ? `-${fingerprint.shortValue}` : "";
  return `${prefix}-${compactTimestamp(exportedAt)}${fingerprintPart}.${extension}`;
}
