import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  localDateKey,
  millisecondsUntilNextLocalMinute,
  startOfLocalDate,
} from "./date";

describe("local date helpers", () => {
  it("formats dates by the local calendar day instead of the UTC day", () => {
    const localEarlyMorning = new Date(2026, 5, 26, 0, 30);

    expect(localDateKey(localEarlyMorning.toISOString())).toBe("2026-06-26");
  });

  it("adds days in local calendar time", () => {
    const start = startOfLocalDate(new Date(2026, 5, 26, 13, 20));

    expect(localDateKey(start)).toBe("2026-06-26");
    expect(localDateKey(addLocalDays(start, -1))).toBe("2026-06-25");
    expect(localDateKey(addLocalDays(start, 1))).toBe("2026-06-27");
  });

  it("calculates the delay until the next local minute", () => {
    const delay = millisecondsUntilNextLocalMinute(new Date(2026, 5, 26, 13, 20, 30, 500), 250);

    expect(delay).toBe(29750);
  });
});
