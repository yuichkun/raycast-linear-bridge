import { describe, expect, it } from "vitest";
import { dueHorizonEnd, isDueWithinHorizon, parseDueHorizon } from "./date";

// Local-time constructors (not ISO strings) so these run the same in any timezone —
// formatDateOnly reads local date parts.
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s);

describe("dueHorizonEnd", () => {
  it("has no end for all", () => {
    expect(dueHorizonEnd("all", at(2026, 8, 25))).toBeUndefined();
  });

  describe("today", () => {
    it("ends today", () => {
      expect(dueHorizonEnd("today", at(2026, 8, 25))).toBe("2026-08-25");
    });

    it("is the same date at 00:00:00 and 23:59:59", () => {
      expect(dueHorizonEnd("today", at(2026, 8, 25, 0, 0, 0))).toBe("2026-08-25");
      expect(dueHorizonEnd("today", at(2026, 8, 25, 23, 59, 59))).toBe("2026-08-25");
    });
  });

  describe("7days (rolling: today + 7, inclusive)", () => {
    it("ends seven days out on an ordinary weekday", () => {
      expect(dueHorizonEnd("7days", at(2026, 8, 25))).toBe("2026-09-01"); // Tue -> next Tue
    });

    // The bug this replaces: the calendar-week horizon ended on Sunday, so opening the
    // list on Sunday night hid everything due Monday — the exact moment it mattered.
    it("still looks a full week ahead on a Sunday", () => {
      expect(dueHorizonEnd("7days", at(2026, 8, 30))).toBe("2026-09-06");
    });

    it("still looks a full week ahead on a Saturday and on a Monday", () => {
      expect(dueHorizonEnd("7days", at(2026, 8, 29))).toBe("2026-09-05");
      expect(dueHorizonEnd("7days", at(2026, 8, 31))).toBe("2026-09-07");
    });

    it("crosses a month boundary", () => {
      expect(dueHorizonEnd("7days", at(2026, 8, 28))).toBe("2026-09-04");
      expect(dueHorizonEnd("7days", at(2026, 9, 30))).toBe("2026-10-07");
    });

    it("crosses a year boundary", () => {
      expect(dueHorizonEnd("7days", at(2026, 12, 28))).toBe("2027-01-04");
      expect(dueHorizonEnd("7days", at(2026, 12, 31))).toBe("2027-01-07");
    });

    it("counts February 29 in a leap year and skips it otherwise", () => {
      expect(dueHorizonEnd("7days", at(2028, 2, 23))).toBe("2028-03-01");
      expect(dueHorizonEnd("7days", at(2027, 2, 23))).toBe("2027-03-02");
    });

    it("does not depend on the time of day", () => {
      expect(dueHorizonEnd("7days", at(2026, 8, 30, 0, 0, 0))).toBe("2026-09-06");
      expect(dueHorizonEnd("7days", at(2026, 8, 30, 23, 59, 59))).toBe("2026-09-06");
    });
  });

  describe("30days (rolling: today + 30, inclusive — a fixed window, not a calendar month)", () => {
    it("ends thirty days out mid-month", () => {
      expect(dueHorizonEnd("30days", at(2026, 8, 26))).toBe("2026-09-25");
    });

    // The bug this replaces: the calendar-month horizon ended on the 31st, so opening
    // the list on the 31st hid everything due on the 1st.
    it("still looks a full month ahead on the last day of a month", () => {
      expect(dueHorizonEnd("30days", at(2026, 8, 31))).toBe("2026-09-30");
      expect(dueHorizonEnd("30days", at(2026, 9, 30))).toBe("2026-10-30");
    });

    it("is thirty days, not 'the same day next month'", () => {
      expect(dueHorizonEnd("30days", at(2026, 1, 31))).toBe("2026-03-02");
      expect(dueHorizonEnd("30days", at(2026, 3, 1))).toBe("2026-03-31");
    });

    it("crosses a year boundary", () => {
      expect(dueHorizonEnd("30days", at(2026, 12, 15))).toBe("2027-01-14");
      expect(dueHorizonEnd("30days", at(2026, 12, 31))).toBe("2027-01-30");
    });

    it("counts February 29 in a leap year and skips it otherwise", () => {
      expect(dueHorizonEnd("30days", at(2028, 2, 1))).toBe("2028-03-02");
      expect(dueHorizonEnd("30days", at(2027, 2, 1))).toBe("2027-03-03");
    });

    it("does not depend on the time of day", () => {
      expect(dueHorizonEnd("30days", at(2026, 8, 31, 0, 0, 0))).toBe("2026-09-30");
      expect(dueHorizonEnd("30days", at(2026, 8, 31, 23, 59, 59))).toBe("2026-09-30");
    });
  });

  it("does not mutate the date it is given", () => {
    const now = at(2026, 8, 30, 12, 0);
    const before = now.getTime();

    dueHorizonEnd("7days", now);
    dueHorizonEnd("30days", now);

    expect(now.getTime()).toBe(before);
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

  it("passes overdue and same-day tasks, drops the day after", () => {
    expect(isDueWithinHorizon("2000-01-01", "2026-08-25")).toBe(true);
    expect(isDueWithinHorizon("2026-08-25", "2026-08-25")).toBe(true);
    expect(isDueWithinHorizon("2026-08-26", "2026-08-25")).toBe(false);
  });

  it("compares across month and year boundaries correctly", () => {
    expect(isDueWithinHorizon("2026-09-01", "2026-09-06")).toBe(true);
    expect(isDueWithinHorizon("2026-09-07", "2026-09-06")).toBe(false);
    expect(isDueWithinHorizon("2027-01-04", "2027-01-04")).toBe(true);
    expect(isDueWithinHorizon("2027-01-05", "2027-01-04")).toBe(false);
  });
});

describe("parseDueHorizon", () => {
  it("accepts every known horizon", () => {
    expect(parseDueHorizon("all")).toBe("all");
    expect(parseDueHorizon("today")).toBe("today");
    expect(parseDueHorizon("7days")).toBe("7days");
    expect(parseDueHorizon("30days")).toBe("30days");
  });

  it("falls back to all for anything unrecognized, including the retired calendar values", () => {
    expect(parseDueHorizon("week")).toBe("all");
    expect(parseDueHorizon("month")).toBe("all");
    expect(parseDueHorizon("fortnight")).toBe("all");
    expect(parseDueHorizon(undefined)).toBe("all");
  });
});
