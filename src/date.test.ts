import { describe, expect, it } from "vitest";
import { dueHorizonEnd, isDueWithinHorizon, parseDueHorizon } from "./date";

// Local-time constructors (not ISO strings) so these run the same in any timezone —
// formatDateOnly reads local date parts.
const tuesday = new Date(2026, 7, 25); // Tue 2026-08-25
const monday = new Date(2026, 7, 24);
const saturday = new Date(2026, 7, 29);
const sunday = new Date(2026, 7, 30);

describe("dueHorizonEnd", () => {
  it("has no end for all", () => {
    expect(dueHorizonEnd("all", tuesday)).toBeUndefined();
  });

  it("ends today for today", () => {
    expect(dueHorizonEnd("today", tuesday)).toBe("2026-08-25");
  });

  it("ends on the coming Sunday for week, with Monday as the first day", () => {
    expect(dueHorizonEnd("week", monday)).toBe("2026-08-30");
    expect(dueHorizonEnd("week", tuesday)).toBe("2026-08-30");
    expect(dueHorizonEnd("week", saturday)).toBe("2026-08-30");
    // Sunday closes its own week — it must not roll over to the next one.
    expect(dueHorizonEnd("week", sunday)).toBe("2026-08-30");
  });

  it("ends on the last calendar day of the month for month", () => {
    expect(dueHorizonEnd("month", tuesday)).toBe("2026-08-31");
    expect(dueHorizonEnd("month", new Date(2026, 1, 10))).toBe("2026-02-28");
    expect(dueHorizonEnd("month", new Date(2028, 1, 10))).toBe("2028-02-29");
    expect(dueHorizonEnd("month", new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("isDueWithinHorizon", () => {
  it("passes everything when there is no horizon", () => {
    expect(isDueWithinHorizon("2999-01-01", undefined)).toBe(true);
    expect(isDueWithinHorizon(undefined, undefined)).toBe(true);
  });

  it("always passes tasks with no due date", () => {
    expect(isDueWithinHorizon(undefined, "2026-08-25")).toBe(true);
  });

  it("passes overdue and same-day tasks, drops future ones", () => {
    expect(isDueWithinHorizon("2000-01-01", "2026-08-25")).toBe(true);
    expect(isDueWithinHorizon("2026-08-25", "2026-08-25")).toBe(true);
    expect(isDueWithinHorizon("2026-08-26", "2026-08-25")).toBe(false);
  });
});

describe("parseDueHorizon", () => {
  it("accepts known horizons", () => {
    expect(parseDueHorizon("week")).toBe("week");
  });

  it("falls back to all for anything unrecognized", () => {
    expect(parseDueHorizon("fortnight")).toBe("all");
    expect(parseDueHorizon(undefined)).toBe("all");
  });
});
