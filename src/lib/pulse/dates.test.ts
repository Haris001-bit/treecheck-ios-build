// Financial Pulse: local calendar dates, windows and paydays (synthetic dates only).
import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfMonth,
  daysInMonth,
  diffDays,
  formatDay,
  isLocalDate,
  isPayFrequency,
  localDate,
  monthEnd,
  monthWindowFor,
  monthStart,
  nextPayday,
  type PayFrequency,
  PAYROLL_DEBIT_LEAD_DAYS,
  PAYROLL_HISTORY_RUNS,
  PAYROLL_LATE_ALLOWANCE_DAYS,
  payrollHistoryWindow,
  type PayrollHistoryWindow,
  payScheduleOf,
  previousPayday,
  recentPaydays,
  WINDOW_KEYS,
  windowsFor,
  periodWindowsFor,
  windowsForSnapshot,
} from "../../../supabase/functions/_shared/pulse/dates";

const FREQUENCIES: PayFrequency[] = ["weekly", "biweekly", "semimonthly", "monthly"];

/** Day of the week, 0 = Sunday. */
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * When a payroll provider debits the employer for `payday`: a weekend payday is paid the Friday
 * before, and the debit posts `lead` business days before that (no holidays).
 */
function debitDate(payday: string, lead: number): string {
  const w = weekday(payday);
  let d = w === 6 ? addDays(payday, -1) : w === 0 ? addDays(payday, -2) : payday;
  for (let i = 0; i < lead; ) {
    d = addDays(d, -1);
    if (weekday(d) !== 0 && weekday(d) !== 6) i++;
  }
  return d;
}

/**
 * When a payday's debit posts if it is paid late: `lag` business days after payday (a check that
 * clears later, or Zelle posting the next business day), no holidays.
 */
function lateDebitDate(payday: string, lag: number): string {
  let d = payday;
  for (let i = 0; i < lag; ) {
    d = addDays(d, 1);
    if (weekday(d) !== 0 && weekday(d) !== 6) i++;
  }
  return d;
}

/** Every payday from `from` to `to`, by walking nextPayday. */
function paydaysBetween(from: string, to: string, frequency: PayFrequency, anchor: string): string[] {
  const out: string[] = [];
  for (let d = nextPayday(from, frequency, anchor); d <= to; d = nextPayday(addDays(d, 1), frequency, anchor)) out.push(d);
  return out;
}

describe("local dates", () => {
  it("accepts only real YYYY-MM-DD dates", () => {
    expect(isLocalDate("2026-10-20")).toBe(true);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-9-1")).toBe(false);
    expect(isLocalDate("2026-10-20T00:00:00Z")).toBe(false);
    expect(isLocalDate(null)).toBe(false);
    expect(isLocalDate(20261020)).toBe(false);
  });

  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-20", -29)).toBe("2026-09-21");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 365)).toBe("2029-02-28");
    expect(addDays("2026-10-20", 0)).toBe("2026-10-20");
  });

  it("never gains or loses a day at a daylight-saving change", () => {
    // US daylight saving ends 2026-11-01 and starts 2026-03-08.
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(diffDays("2026-11-02", "2026-10-31")).toBe(2);
    expect(diffDays("2026-03-09", "2026-03-07")).toBe(2);
  });

  it("diffDays is a minus b", () => {
    expect(diffDays("2026-10-05", "2026-10-01")).toBe(4);
    expect(diffDays("2026-10-01", "2026-10-05")).toBe(-4);
    expect(diffDays("2027-01-01", "2026-01-01")).toBe(365);
    expect(diffDays("2029-01-01", "2028-01-01")).toBe(366);
  });

  it("refuses bad input instead of guessing", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(/YYYY-MM-DD/);
    expect(() => addDays("2026-10-01", 1.5)).toThrow(/whole number/);
    expect(() => diffDays("yesterday", "2026-10-01")).toThrow();
  });

  it("knows month lengths, including leap years", () => {
    expect(daysInMonth("2026-02-10")).toBe(28);
    expect(daysInMonth("2028-02-10")).toBe(29);
    expect(daysInMonth("2100-02-10")).toBe(28);
    expect(daysInMonth("2000-02-10")).toBe(29);
    expect(daysInMonth("2026-09-30")).toBe(30);
    expect(daysInMonth("2026-10-01")).toBe(31);
    expect(dayOfMonth("2026-10-20")).toBe(20);
    expect(monthStart("2026-10-20")).toBe("2026-10-01");
    expect(monthEnd("2026-10-20")).toBe("2026-10-31");
    expect(monthEnd("2028-02-03")).toBe("2028-02-29");
    expect(formatDay("2026-10-07")).toBe("Oct 7, 2026");
  });
});

describe("windows", () => {
  it("MTD, L30 and L7 end today and are inclusive; P30 is the 30 days before L30 (no L56 or L3M)", () => {
    expect(windowsFor("2026-10-20")).toEqual([
      { key: "MTD", from: "2026-10-01", to: "2026-10-20" },
      { key: "L30", from: "2026-09-21", to: "2026-10-20" },
      { key: "P30", from: "2026-08-22", to: "2026-09-20" },
      { key: "L7", from: "2026-10-14", to: "2026-10-20" },
    ]);
    expect([...WINDOW_KEYS]).toEqual(["MTD", "L30", "P30", "L7"]);
    expect(windowsFor("2026-10-20").map((w) => w.key)).toEqual([...WINDOW_KEYS]);
    // The period filter's extra windows (engine-3), across a month and a year end.
    expect(periodWindowsFor("2026-10-20")).toEqual([
      { key: "L14", from: "2026-10-07", to: "2026-10-20" },
      { key: "P14", from: "2026-09-23", to: "2026-10-06" },
      { key: "P7", from: "2026-10-07", to: "2026-10-13" },
    ]);
    expect(periodWindowsFor("2027-01-05")).toEqual([
      { key: "L14", from: "2026-12-23", to: "2027-01-05" },
      { key: "P14", from: "2026-12-09", to: "2026-12-22" },
      { key: "P7", from: "2026-12-23", to: "2026-12-29" },
    ]);
  });

  it("PMTD is last month's same days, clamped to its length (engine-6)", () => {
    const pmtd = (today: string) => {
      const w = monthWindowFor(today);
      expect(w.key).toBe("PMTD");
      return [w.from, w.to];
    };
    expect(pmtd("2026-10-20")).toEqual(["2026-09-01", "2026-09-20"]);
    // October 31 compares with all of September (30 days).
    expect(pmtd("2026-10-31")).toEqual(["2026-09-01", "2026-09-30"]);
    // March 31 compares with all of February, 28 days in 2026 and 29 in 2028.
    expect(pmtd("2026-03-31")).toEqual(["2026-02-01", "2026-02-28"]);
    expect(pmtd("2028-03-30")).toEqual(["2028-02-01", "2028-02-29"]);
    // Across the year end, and the first of a month.
    expect(pmtd("2026-01-15")).toEqual(["2025-12-01", "2025-12-15"]);
    expect(pmtd("2026-03-01")).toEqual(["2026-02-01", "2026-02-01"]);
  });

  it("have the right lengths and P30 ends the day before L30 starts", () => {
    for (const today of ["2026-10-20", "2026-03-01", "2028-03-01", "2026-11-01", "2027-01-01"]) {
      const w = Object.fromEntries(windowsFor(today).map((x) => [x.key, x]));
      expect(diffDays(w.L30.to, w.L30.from) + 1).toBe(30);
      expect(diffDays(w.P30.to, w.P30.from) + 1).toBe(30);
      expect(diffDays(w.L7.to, w.L7.from) + 1).toBe(7);
      expect(addDays(w.P30.to, 1)).toBe(w.L30.from);
      expect(diffDays(w.MTD.to, w.MTD.from) + 1).toBe(dayOfMonth(today));
    }
  });

  it("cross February correctly in normal and leap years", () => {
    expect(windowsFor("2026-03-01")[1]).toEqual({ key: "L30", from: "2026-01-31", to: "2026-03-01" });
    expect(windowsFor("2028-03-01")[1]).toEqual({ key: "L30", from: "2028-02-01", to: "2028-03-01" });
    expect(windowsFor("2026-03-01")[0]).toEqual({ key: "MTD", from: "2026-03-01", to: "2026-03-01" });
  });
});

describe("company local date (time zones stay outside the date maths)", () => {
  it("2026-10-01T03:30Z is still Sep 30 in Chicago, so September's windows apply", () => {
    const today = localDate("2026-10-01T03:30:00Z", "America/Chicago");
    expect(today).toBe("2026-09-30");
    expect(windowsFor(today)[0]).toEqual({ key: "MTD", from: "2026-09-01", to: "2026-09-30" });
    expect(localDate("2026-10-01T03:30:00Z", "UTC")).toBe("2026-10-01");
  });

  it("follows the Chicago offset change when daylight saving ends on 2026-11-01", () => {
    expect(localDate("2026-11-01T04:30:00Z", "America/Chicago")).toBe("2026-10-31");
    expect(localDate("2026-11-01T06:30:00Z", "America/Chicago")).toBe("2026-11-01");
    // 05:30Z is 23:30 the day before once Chicago is back on UTC-6.
    expect(localDate("2026-11-02T05:30:00Z", "America/Chicago")).toBe("2026-11-01");
    expect(windowsFor("2026-11-01")[3]).toEqual({ key: "L7", from: "2026-10-26", to: "2026-11-01" });
  });
});

describe("paydays", () => {
  it("only knows the four stored frequencies", () => {
    expect(isPayFrequency("weekly")).toBe(true);
    expect(isPayFrequency("semimonthly")).toBe(true);
    expect(isPayFrequency("fortnightly")).toBe(false);
    expect(isPayFrequency(null)).toBe(false);
  });

  it("weekly: every 7 days from the anchor, today included", () => {
    // 2026-10-02 is a Friday.
    expect(nextPayday("2026-10-20", "weekly", "2026-10-02")).toBe("2026-10-23");
    expect(nextPayday("2026-10-23", "weekly", "2026-10-02")).toBe("2026-10-23");
    expect(nextPayday("2026-10-24", "weekly", "2026-10-02")).toBe("2026-10-30");
    // An anchor in the future works the same way.
    expect(nextPayday("2026-10-20", "weekly", "2026-12-04")).toBe("2026-10-23");
    // Across the end of daylight saving.
    expect(nextPayday("2026-11-01", "weekly", "2026-10-30")).toBe("2026-11-06");
  });

  it("biweekly: every 14 days from the anchor", () => {
    expect(nextPayday("2026-10-20", "biweekly", "2026-10-02")).toBe("2026-10-30");
    expect(nextPayday("2026-10-16", "biweekly", "2026-10-02")).toBe("2026-10-16");
    expect(nextPayday("2026-10-17", "biweekly", "2026-10-02")).toBe("2026-10-30");
    expect(nextPayday("2026-10-20", "biweekly", "2027-01-08")).toBe("2026-10-30");
    expect(nextPayday("2027-01-02", "biweekly", "2026-12-25")).toBe("2027-01-08");
  });

  it("semimonthly: an anchor on the 15th or a month end means the 15th and the last day", () => {
    expect(nextPayday("2026-10-01", "semimonthly", "2026-09-15")).toBe("2026-10-15");
    expect(nextPayday("2026-10-15", "semimonthly", "2026-09-15")).toBe("2026-10-15");
    expect(nextPayday("2026-10-20", "semimonthly", "2026-09-15")).toBe("2026-10-31");
    expect(nextPayday("2026-10-31", "semimonthly", "2026-09-15")).toBe("2026-10-31");
    expect(nextPayday("2026-11-01", "semimonthly", "2026-09-15")).toBe("2026-11-15");
    expect(nextPayday("2026-11-16", "semimonthly", "2026-09-15")).toBe("2026-11-30");
    // Any month end as the anchor, in a 30- or 31-day month or in February.
    for (const anchor of ["2026-09-30", "2026-08-31", "2026-02-28", "2028-02-29"]) {
      expect(nextPayday("2026-09-15", "semimonthly", anchor)).toBe("2026-09-15");
      expect(nextPayday("2026-10-16", "semimonthly", anchor)).toBe("2026-10-31");
      expect(nextPayday("2026-09-16", "semimonthly", anchor)).toBe("2026-09-30");
    }
  });

  it("semimonthly: an anchor on the 1st means the 1st and the 15th", () => {
    expect(nextPayday("2026-10-01", "semimonthly", "2026-09-01")).toBe("2026-10-01");
    expect(nextPayday("2026-10-02", "semimonthly", "2026-09-01")).toBe("2026-10-15");
    expect(nextPayday("2026-10-15", "semimonthly", "2026-09-01")).toBe("2026-10-15");
    expect(nextPayday("2026-10-16", "semimonthly", "2026-09-01")).toBe("2026-11-01");
    expect(nextPayday("2026-12-31", "semimonthly", "2026-09-01")).toBe("2027-01-01");
  });

  it("semimonthly: any other anchor day and 15 days from it", () => {
    // An anchor on the 30th of a 31-day month really is the 30th: the 15th and the 30th.
    expect(nextPayday("2026-10-16", "semimonthly", "2026-10-30")).toBe("2026-10-30");
    expect(nextPayday("2026-10-31", "semimonthly", "2026-10-30")).toBe("2026-11-15");
    // The 16th means the 1st and the 16th.
    expect(nextPayday("2026-10-02", "semimonthly", "2026-09-16")).toBe("2026-10-16");
    // Anchor on the 20th means the 5th and the 20th.
    expect(nextPayday("2026-10-20", "semimonthly", "2026-09-20")).toBe("2026-10-20");
    expect(nextPayday("2026-10-21", "semimonthly", "2026-09-05")).toBe("2026-11-05");
    expect(nextPayday("2026-12-21", "semimonthly", "2026-09-05")).toBe("2027-01-05");
  });

  it("semimonthly: the later payday is clamped to the month length (Feb and leap years)", () => {
    expect(nextPayday("2026-02-16", "semimonthly", "2026-09-15")).toBe("2026-02-28");
    expect(nextPayday("2028-02-16", "semimonthly", "2026-09-15")).toBe("2028-02-29");
    expect(nextPayday("2026-02-15", "semimonthly", "2026-08-14")).toBe("2026-02-28");
    expect(nextPayday("2028-02-15", "semimonthly", "2026-08-14")).toBe("2028-02-29");
    expect(nextPayday("2026-03-15", "semimonthly", "2026-08-14")).toBe("2026-03-29");
  });

  it("monthly: an anchor on a month end means the last day of every month", () => {
    expect(nextPayday("2026-10-01", "monthly", "2026-09-30")).toBe("2026-10-31");
    expect(nextPayday("2026-03-01", "monthly", "2026-02-28")).toBe("2026-03-31");
    expect(nextPayday("2026-04-01", "monthly", "2028-02-29")).toBe("2026-04-30");
    expect(nextPayday("2026-11-01", "monthly", "2026-10-31")).toBe("2026-11-30");
    // The 28th or the 30th of a 31-day month is that day, clamped in February.
    expect(nextPayday("2026-10-01", "monthly", "2026-01-28")).toBe("2026-10-28");
    expect(nextPayday("2026-10-01", "monthly", "2026-10-30")).toBe("2026-10-30");
    expect(nextPayday("2027-02-01", "monthly", "2026-10-30")).toBe("2027-02-28");
  });

  it("monthly: the anchor's day, clamped to the month length", () => {
    expect(nextPayday("2026-02-01", "monthly", "2026-01-31")).toBe("2026-02-28");
    expect(nextPayday("2028-02-01", "monthly", "2026-01-31")).toBe("2028-02-29");
    expect(nextPayday("2026-04-15", "monthly", "2026-01-31")).toBe("2026-04-30");
    expect(nextPayday("2026-03-31", "monthly", "2026-01-31")).toBe("2026-03-31");
    expect(nextPayday("2026-10-15", "monthly", "2026-09-15")).toBe("2026-10-15");
    expect(nextPayday("2026-10-16", "monthly", "2026-09-15")).toBe("2026-11-15");
    expect(nextPayday("2026-12-20", "monthly", "2026-09-15")).toBe("2027-01-15");
  });
});

describe("previous paydays", () => {
  it("the last payday on or before today, by the same rules", () => {
    // Weekly and biweekly from past and future anchors.
    expect(previousPayday("2026-10-20", "weekly", "2026-10-02")).toBe("2026-10-16");
    expect(previousPayday("2026-10-16", "weekly", "2026-10-02")).toBe("2026-10-16");
    expect(previousPayday("2026-10-20", "weekly", "2026-12-04")).toBe("2026-10-16");
    expect(previousPayday("2026-10-20", "biweekly", "2026-10-02")).toBe("2026-10-16");
    expect(previousPayday("2026-10-15", "biweekly", "2026-10-02")).toBe("2026-10-02");
    expect(previousPayday("2027-01-07", "biweekly", "2026-12-25")).toBe("2026-12-25");
    // Semimonthly pairs and clamps.
    expect(previousPayday("2026-10-20", "semimonthly", "2026-09-15")).toBe("2026-10-15");
    expect(previousPayday("2026-10-14", "semimonthly", "2026-09-15")).toBe("2026-09-30");
    expect(previousPayday("2026-10-01", "semimonthly", "2026-09-01")).toBe("2026-10-01");
    expect(previousPayday("2027-01-14", "semimonthly", "2026-09-01")).toBe("2027-01-01");
    expect(previousPayday("2026-03-10", "semimonthly", "2026-08-14")).toBe("2026-02-28");
    expect(previousPayday("2028-03-10", "semimonthly", "2026-08-14")).toBe("2028-02-29");
    // Monthly, across the year end and with the last-day rule.
    expect(previousPayday("2027-01-10", "monthly", "2026-09-15")).toBe("2026-12-15");
    expect(previousPayday("2026-03-30", "monthly", "2026-01-31")).toBe("2026-02-28");
    expect(previousPayday("2026-10-30", "monthly", "2026-09-30")).toBe("2026-09-30");
    expect(previousPayday("2026-10-31", "monthly", "2026-09-30")).toBe("2026-10-31");
  });

  it("on every day it is a payday, not after today, and no payday lies between it and today", () => {
    const anchors = ["2026-01-01", "2026-01-15", "2026-01-31", "2026-02-28", "2026-03-05", "2026-04-20", "2026-06-30", "2027-03-12"];
    const wrong: string[] = [];
    let today = "2026-11-01";
    for (let i = 0; i < 520; i++, today = addDays(today, 1)) {
      for (const anchor of anchors) {
        for (const freq of FREQUENCIES) {
          const p = previousPayday(today, freq, anchor);
          if (p > today || nextPayday(p, freq, anchor) !== p || nextPayday(addDays(p, 1), freq, anchor) <= today) {
            wrong.push(`${today} ${freq} ${anchor}: ${p}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("recentPaydays lists the last n paydays, newest first", () => {
    expect(recentPaydays("2026-10-20", "monthly", "2026-09-15", 3)).toEqual(["2026-10-15", "2026-09-15", "2026-08-15"]);
    expect(recentPaydays("2026-10-20", "semimonthly", "2026-09-15", 6))
      .toEqual(["2026-10-15", "2026-09-30", "2026-09-15", "2026-08-31", "2026-08-15", "2026-07-31"]);
    expect(recentPaydays("2026-10-20", "biweekly", "2026-10-02", 0)).toEqual([]);
  });
});

describe("payroll history window (aligned to the pay schedule)", () => {
  it("reads the pay schedule from settings only when both parts are valid", () => {
    expect(payScheduleOf({ pay_frequency: "monthly", pay_anchor_date: "2026-09-15" })).toEqual({ frequency: "monthly", anchor: "2026-09-15" });
    expect(payScheduleOf({ pay_frequency: "monthly", pay_anchor_date: null })).toBeNull();
    expect(payScheduleOf({ pay_frequency: "fortnightly", pay_anchor_date: "2026-09-15" })).toBeNull();
    expect(payScheduleOf({ pay_frequency: "weekly", pay_anchor_date: "2026-02-30" })).toBeNull();
    expect(payScheduleOf(null)).toBeNull();
  });

  it("the last N paydays at least A + 1 days old, from 6 days before the oldest to A days after the newest", () => {
    expect(PAYROLL_HISTORY_RUNS).toEqual({ weekly: 8, biweekly: 4, semimonthly: 6, monthly: 3 });
    expect(PAYROLL_LATE_ALLOWANCE_DAYS).toEqual({ weekly: 0, biweekly: 7, semimonthly: 6, monthly: 21 });
    expect(PAYROLL_DEBIT_LEAD_DAYS).toBe(6);
    // Weekly (A = 0): the Fridays up to yesterday, Oct 16 the newest.
    expect(payrollHistoryWindow("2026-10-20", "weekly", "2026-10-02", null)).toEqual({ from: "2026-08-22", to: "2026-10-16", runs: 8 });
    // Biweekly (A = 7): Oct 16 is only 4 days old, so Aug 21 to Oct 2, ending 7 days after Oct 2.
    expect(payrollHistoryWindow("2026-10-20", "biweekly", "2026-10-02", null)).toEqual({ from: "2026-08-15", to: "2026-10-09", runs: 4 });
    // Semimonthly (A = 6): Oct 15 is only 5 days old, so Jul 15 to Sep 30.
    expect(payrollHistoryWindow("2026-10-20", "semimonthly", "2026-09-15", null)).toEqual({ from: "2026-07-09", to: "2026-10-06", runs: 6 });
    // Oct 15 is still not counted on Oct 21, when it is exactly A = 6 days old (its last allowed
    // debit day is today, so that debit may not have reached the data yet), and counts from Oct 22.
    expect(payrollHistoryWindow("2026-10-21", "semimonthly", "2026-09-15", null)).toEqual({ from: "2026-07-09", to: "2026-10-06", runs: 6 });
    expect(payrollHistoryWindow("2026-10-22", "semimonthly", "2026-09-15", null)).toEqual({ from: "2026-07-25", to: "2026-10-21", runs: 6 });
    // Monthly on the last day (A = 21): Sep 30 is only 20 days old on Oct 20 and exactly 21 on
    // Oct 21, and counts from Oct 22 (A + 1 = 22 days after it).
    expect(payrollHistoryWindow("2026-10-20", "monthly", "2026-08-31", null)).toEqual({ from: "2026-06-24", to: "2026-09-21", runs: 3 });
    expect(payrollHistoryWindow("2026-10-21", "monthly", "2026-08-31", null)).toEqual({ from: "2026-06-24", to: "2026-09-21", runs: 3 });
    expect(payrollHistoryWindow("2026-10-22", "monthly", "2026-08-31", null)).toEqual({ from: "2026-07-25", to: "2026-10-21", runs: 3 });
    // Across the year end.
    expect(payrollHistoryWindow("2027-01-10", "monthly", "2026-09-15", null)).toEqual({ from: "2026-10-09", to: "2027-01-05", runs: 3 });
  });

  it("a payday today, whose debit may still be pending, is not counted as a run yet (round-3 finding 1)", () => {
    // Monthly on the 15th, on payday: Sep 15 is the newest run; Oct 15 counts from Nov 6, A + 1 = 22
    // days after it (on Nov 5 its last allowed debit day is today).
    expect(payrollHistoryWindow("2026-10-15", "monthly", "2026-09-15", null)).toEqual({ from: "2026-07-09", to: "2026-10-06", runs: 3 });
    expect(payrollHistoryWindow("2026-11-04", "monthly", "2026-09-15", null)).toEqual({ from: "2026-07-09", to: "2026-10-06", runs: 3 });
    expect(payrollHistoryWindow("2026-11-05", "monthly", "2026-09-15", null)).toEqual({ from: "2026-07-09", to: "2026-10-06", runs: 3 });
    expect(payrollHistoryWindow("2026-11-06", "monthly", "2026-09-15", null)).toEqual({ from: "2026-08-09", to: "2026-11-05", runs: 3 });
    // Semimonthly on the 15th and the last day, on Oct 15: Sep 30 is the newest run.
    expect(payrollHistoryWindow("2026-10-15", "semimonthly", "2026-09-15", null)).toEqual({ from: "2026-07-09", to: "2026-10-06", runs: 6 });
    // Weekly (A = 0) on payday Fri Oct 16: that Friday counts from the next day.
    expect(payrollHistoryWindow("2026-10-16", "weekly", "2026-10-02", null)).toEqual({ from: "2026-08-15", to: "2026-10-09", runs: 8 });
    expect(payrollHistoryWindow("2026-10-17", "weekly", "2026-10-02", null)).toEqual({ from: "2026-08-22", to: "2026-10-16", runs: 8 });
    // Biweekly on payday Oct 16: Oct 2 is the newest run through Oct 23 (Oct 16 is then exactly
    // A = 7 days old); Oct 16 counts from Oct 24, A + 1 = 8 days after it.
    expect(payrollHistoryWindow("2026-10-16", "biweekly", "2026-10-02", null)).toEqual({ from: "2026-08-15", to: "2026-10-09", runs: 4 });
    expect(payrollHistoryWindow("2026-10-23", "biweekly", "2026-10-02", null)).toEqual({ from: "2026-08-15", to: "2026-10-09", runs: 4 });
    expect(payrollHistoryWindow("2026-10-24", "biweekly", "2026-10-02", null)).toEqual({ from: "2026-08-29", to: "2026-10-23", runs: 4 });
  });

  it("debits 1 and 3 business days after payday count for their own run (round-3 finding 1)", () => {
    const posted = (debits: string[], today: string, w: PayrollHistoryWindow | null) =>
      w ? debits.filter((d) => d <= today && d >= w.from && d <= w.to) : [];
    // Biweekly Fridays paid by Zelle, posting the next business day (the Monday). On Oct 20 the
    // Oct 16 run (posted Oct 19) is not in yet; the 4 runs Aug 21 to Oct 2 are, each exactly once.
    const zelle = paydaysBetween("2026-06-01", "2026-12-31", "biweekly", "2026-10-02").map((p) => lateDebitDate(p, 1));
    expect(zelle).toEqual(expect.arrayContaining(["2026-10-05", "2026-10-19"]));
    expect(posted(zelle, "2026-10-20", payrollHistoryWindow("2026-10-20", "biweekly", "2026-10-02", null)))
      .toEqual(["2026-08-24", "2026-09-07", "2026-09-21", "2026-10-05"]);
    // Monthly on the 15th by check, clearing 3 business days later. On Oct 20 the Oct 15 check
    // clears today and is not in; Jul, Aug and Sep are.
    const checks = paydaysBetween("2026-01-01", "2026-12-31", "monthly", "2026-09-15").map((p) => lateDebitDate(p, 3));
    expect(checks).toEqual(expect.arrayContaining(["2026-08-19", "2026-10-20"]));
    expect(posted(checks, "2026-10-20", payrollHistoryWindow("2026-10-20", "monthly", "2026-09-15", null)))
      .toEqual(["2026-07-20", "2026-08-19", "2026-09-18"]);
    // Every day through 2026 and past the year end, for every frequency: exactly N posted debits.
    const cases: Array<[PayFrequency, string]> = [
      ["weekly", "2026-10-02"],
      ["biweekly", "2026-10-02"],
      ["semimonthly", "2026-09-15"],
      ["semimonthly", "2026-09-05"],
      ["monthly", "2026-09-15"],
      ["monthly", "2026-08-31"],
    ];
    const wrong: string[] = [];
    for (const [freq, anchor] of cases) {
      const paydays = paydaysBetween("2025-06-01", "2027-06-30", freq, anchor);
      for (const lag of [1, 3]) {
        const debits = paydays.map((p) => lateDebitDate(p, lag));
        for (let today = "2026-01-01"; today <= "2027-01-31"; today = addDays(today, 1)) {
          const n = posted(debits, today, payrollHistoryWindow(today, freq, anchor, null)).length;
          if (n !== PAYROLL_HISTORY_RUNS[freq]) wrong.push(`${freq} ${anchor} lag ${lag} ${today}: ${n}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 30_000);

  it("drops paydays whose debit could predate the payroll counted-from date (round-2 finding 1)", () => {
    // Payroll counted from 2026-09-01, monthly on the 15th (A = 21): Aug 15 - 6 days is before Sep 1.
    const w = (today: string) => payrollHistoryWindow(today, "monthly", "2026-09-15", "2026-09-01");
    // Sep 15 counts from Oct 7, A + 1 = 22 days after it (on Oct 6 its last allowed debit day is today).
    expect(w("2026-10-05")).toBeNull();
    expect(w("2026-10-06")).toBeNull();
    expect(w("2026-10-07")).toEqual({ from: "2026-09-09", to: "2026-10-06", runs: 1 });
    expect(w("2026-10-10")).toEqual({ from: "2026-09-09", to: "2026-10-06", runs: 1 });
    // The round-2 repro's day: Oct 15 was paid only 5 days ago, so Sep 15 alone.
    expect(w("2026-10-20")).toEqual({ from: "2026-09-09", to: "2026-10-06", runs: 1 });
    expect(w("2026-11-20")).toEqual({ from: "2026-09-09", to: "2026-11-05", runs: 2 });
    expect(w("2026-12-20")).toEqual({ from: "2026-09-09", to: "2026-12-06", runs: 3 });
    expect(w("2027-01-20")).toEqual({ from: "2026-10-09", to: "2027-01-05", runs: 3 });
    // Before any payday is counted there is no window yet.
    expect(w("2026-09-14")).toBeNull();
    // A payday exactly 6 days after the counted-from date is kept, 5 days after is not.
    expect(payrollHistoryWindow("2026-11-10", "monthly", "2026-09-15", "2026-10-09")).toEqual({ from: "2026-10-09", to: "2026-11-05", runs: 1 });
    expect(payrollHistoryWindow("2026-11-10", "monthly", "2026-09-15", "2026-10-10")).toBeNull();
    // A counted-from date far back changes nothing.
    expect(payrollHistoryWindow("2026-10-20", "monthly", "2026-09-15", "2020-01-01")).toEqual({ from: "2026-07-09", to: "2026-10-06", runs: 3 });
    expect(() => payrollHistoryWindow("2026-10-20", "monthly", "2026-09-15", "2026-02-30")).toThrow(/countedFrom/);
  });

  it("on sampled days, holds exactly N paydays, starts on or after the counted-from date and ends A days after the newest payday at least A + 1 days old, so by yesterday", () => {
    // Every 6th day from Jan 2026 to Mar 2028 (a leap February included) with full coverage, and
    // every 17th day with two counted-from dates as well.
    const anchors = ["2026-01-01", "2026-01-15", "2026-01-31", "2026-02-28", "2026-03-05", "2026-04-20", "2026-06-30"];
    const wrong: string[] = [];
    let today = "2026-01-01";
    for (let i = 0; i < 820; i++, today = addDays(today, 1)) {
      const countedFroms = i % 17 === 0 ? [null, "2026-02-10", "2026-06-03"] : i % 6 === 0 ? [null] : [];
      for (const anchor of anchors) {
        for (const freq of FREQUENCIES) {
          const late = PAYROLL_LATE_ALLOWANCE_DAYS[freq];
          // A payday counts once it is at least A + 1 days old.
          const settled = addDays(today, -(late + 1));
          for (const countedFrom of countedFroms) {
            const win = payrollHistoryWindow(today, freq, anchor, countedFrom);
            const last = recentPaydays(settled, freq, anchor, PAYROLL_HISTORY_RUNS[freq]);
            const expected = last.filter((p) => countedFrom === null || addDays(p, -6) >= countedFrom);
            const label = `${today} ${freq} ${anchor} ${countedFrom}`;
            if (expected.length === 0) {
              if (win !== null) wrong.push(`${label}: expected none`);
              continue;
            }
            if (!win) {
              wrong.push(`${label}: missing`);
              continue;
            }
            const inside = paydaysBetween(win.from, win.to, freq, anchor);
            if (
              win.runs !== expected.length ||
              inside.length !== win.runs ||
              inside[inside.length - 1] !== previousPayday(settled, freq, anchor) ||
              win.to !== addDays(inside[inside.length - 1], late) ||
              diffDays(today, inside[inside.length - 1]) < late + 1 ||
              win.to >= today ||
              (countedFrom !== null && win.from < countedFrom) ||
              diffDays(inside[0], win.from) !== 6
            ) {
              wrong.push(`${label}: ${JSON.stringify(win)}`);
            }
            if (countedFrom === null && win.runs !== PAYROLL_HISTORY_RUNS[freq]) wrong.push(`${label}: not full`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 30_000);

  it("monthly on the 3rd with debits 2 business days early: exactly 3 debits every day, across the year end (round-2 finding 3)", () => {
    const debits = paydaysBetween("2025-06-01", "2027-06-30", "monthly", "2026-01-03").map((p) => debitDate(p, 2));
    // The debits the review named.
    expect(debits).toEqual(expect.arrayContaining(["2025-12-31", "2026-01-30", "2026-02-27", "2026-04-01"]));
    const wrong: string[] = [];
    for (let today = "2025-12-01"; today <= "2027-02-28"; today = addDays(today, 1)) {
      const win = payrollHistoryWindow(today, "monthly", "2026-01-03", null);
      const n = win ? debits.filter((d) => d >= win.from && d <= win.to).length : -1;
      if (n !== 3) wrong.push(`${today}: ${n}`);
    }
    expect(wrong).toEqual([]);
    // The two days the review probed: Jan 10 (4 debits in L3M) and Apr 10 (2 debits in L3M).
    expect(payrollHistoryWindow("2026-01-10", "monthly", "2026-01-03", null)).toEqual({ from: "2025-09-27", to: "2025-12-24", runs: 3 });
    expect(payrollHistoryWindow("2026-04-10", "monthly", "2026-01-03", null)).toEqual({ from: "2025-12-28", to: "2026-03-24", runs: 3 });
  });

  it("every frequency, with debits 0 to 4 business days before payday: exactly N debits, never the next run's", () => {
    const anchors = ["2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-01", "2026-01-15", "2026-01-31", "2026-01-20"];
    const wrong: string[] = [];
    for (const freq of FREQUENCIES) {
      for (const anchor of anchors) {
        for (let lead = 0; lead <= 4; lead++) {
          const debits = paydaysBetween("2025-06-01", "2027-06-30", freq, anchor).map((p) => debitDate(p, lead));
          for (let today = "2026-01-01"; today <= "2027-01-31"; today = addDays(today, 5)) {
            const win = payrollHistoryWindow(today, freq, anchor, null);
            const n = win ? debits.filter((d) => d >= win.from && d <= win.to).length : -1;
            if (n !== PAYROLL_HISTORY_RUNS[freq]) wrong.push(`${freq} ${anchor} lead ${lead} ${today}: ${n}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 30_000);

  it("sweep: every frequency and anchor (month ends included), debits a constant 6 days early to A days late, every 3rd day for 18 months: exactly N posted debits (round-3 finding 1)", () => {
    // The verifier's sweep. Weekly (A = 0) is also checked up to 3 days late: the run before the
    // oldest slides in as the newest slides out, so it still holds 8.
    const anchors = [
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-14",
      "2026-01-15",
      "2026-01-20",
      "2026-01-29",
      "2026-01-30",
      "2026-01-31",
      "2026-04-30",
    ];
    const days: string[] = [];
    for (let d = "2026-01-01"; d <= "2027-06-30"; d = addDays(d, 3)) days.push(d);
    const wrong: string[] = [];
    let checked = 0;
    for (const freq of FREQUENCIES) {
      const late = PAYROLL_LATE_ALLOWANCE_DAYS[freq];
      for (const anchor of anchors) {
        const paydays = paydaysBetween("2025-01-01", "2027-12-31", freq, anchor);
        const wins = days.map((today) => ({ today, win: payrollHistoryWindow(today, freq, anchor, null) }));
        for (let offset = -PAYROLL_DEBIT_LEAD_DAYS; offset <= Math.max(late, 3); offset++) {
          const debits = paydays.map((p) => addDays(p, offset));
          for (const { today, win } of wins) {
            checked++;
            // Only debits posted by today exist in the bank data.
            const n = win ? debits.filter((d) => d <= today && d >= win.from && d <= win.to).length : -1;
            // The window always ends by yesterday.
            if (!win || n !== PAYROLL_HISTORY_RUNS[freq] || win.runs !== n || win.to >= today) {
              wrong.push(`${freq} ${anchor} offset ${offset} ${today}: ${n} ${JSON.stringify(win)}`);
            }
          }
        }
      }
    }
    expect(wrong.slice(0, 10)).toEqual([]);
    expect(checked).toBe(118_300);
  }, 60_000);

  it("windowsForSnapshot adds PAY only when there is a schedule and a payroll history window", () => {
    const fixed = [...windowsFor("2026-10-20"), ...periodWindowsFor("2026-10-20"), monthWindowFor("2026-10-20")];
    expect(windowsForSnapshot("2026-10-20", null, null)).toEqual(fixed);
    expect(windowsForSnapshot("2026-10-20", { pay_frequency: "monthly", pay_anchor_date: null }, null)).toEqual(fixed);
    const monthly = { pay_frequency: "monthly", pay_anchor_date: "2026-09-15" };
    // The third argument is the payroll accounts' counted-from date (payrollCountedFrom).
    expect(windowsForSnapshot("2026-10-20", monthly, "2026-09-01")).toEqual([
      ...fixed,
      { key: "PAY", from: "2026-09-09", to: "2026-10-06" },
    ]);
    expect(windowsForSnapshot("2026-10-20", monthly, null)).toEqual([...fixed, { key: "PAY", from: "2026-07-09", to: "2026-10-06" }]);
    // Every payday predates the counted-from date: no PAY window yet.
    expect(windowsForSnapshot("2026-10-20", monthly, "2026-10-12")).toEqual(fixed);
  });
});
