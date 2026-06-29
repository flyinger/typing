import { describe, expect, it } from "vitest";
import type { SyncDataFingerprint } from "../types";
import {
  compactTimestamp,
  eventsJsonlFilename,
  sessionsCsvFilename,
  syncFolderManifestFilename,
  syncPackageFilename,
  weeklyReviewMarkdownFilename,
} from "./exportNames";

const fingerprint: SyncDataFingerprint = {
  schemaVersion: 1,
  algorithm: "fnv1a64-stable-json-v1",
  value: "1234567890abcdef",
  shortValue: "1234567890ab",
  counts: {
    sessions: 2,
    events: 6,
    materials: 1,
  },
};

describe("export filenames", () => {
  it("uses compact timestamps so same-day exports do not overwrite each other", () => {
    expect(compactTimestamp("2026-06-29T07:08:09.123Z")).toBe("20260629T070809Z");
  });

  it("adds the sync data fingerprint to authoritative sync exports", () => {
    const exportedAt = "2026-06-29T07:08:09.123Z";

    expect(syncPackageFilename(exportedAt, fingerprint)).toBe(
      "typinglab-sync-20260629T070809Z-1234567890ab.json",
    );
    expect(syncFolderManifestFilename(exportedAt, fingerprint)).toBe(
      "typinglab-sync-folder-20260629T070809Z-1234567890ab.json",
    );
  });

  it("keeps raw report exports timestamped but not fingerprinted", () => {
    const exportedAt = "2026-06-29T07:08:09.123Z";

    expect(eventsJsonlFilename(exportedAt)).toBe("typinglab-events-20260629T070809Z.jsonl");
    expect(sessionsCsvFilename(exportedAt)).toBe("typinglab-sessions-20260629T070809Z.csv");
    expect(weeklyReviewMarkdownFilename("2026-06-29")).toBe("typinglab-weekly-review-2026-06-29.md");
  });

  it("falls back to an explicit unknown timestamp for invalid dates", () => {
    expect(syncPackageFilename("not-a-date")).toBe("typinglab-sync-unknown-time.json");
  });
});
