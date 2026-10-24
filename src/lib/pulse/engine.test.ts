// Financial Pulse: the calculation engine (synthetic numbers only, never real data).
import { describe, expect, it } from "vitest";
import {
  accountCountedFrom,
  cashflowWindows,
  type BankItemInput,
  type BusinessAccountInput,
  computeSnapshot,
  type EngineInput,
  type EngineSettings,
  ENGINE_VERSION,
  homeSummaryOf,
  money,
  type PayrollAccountInput,
  payrollCountedFrom,
  PAYROLL_UNKNOWN_TEXT,
  profitDropped,
  type ScheduledInput,
  shownProfitDrop,
  type Snapshot,
} from "../../../supabase/functions/_shared/pulse/engine";
import {
  addDays,
  localDate,
  monthEnd,
  nextPayday,
  type PayFrequency,
  type SnapshotWindowKey,
  windowsFor,
  windowsForSnapshot,
} from "../../../supabase/functions/_shared/pulse/dates";
import type { WindowTotals } from "../../../supabase/functions/_shared/pulse/types";
import { stillArriving } from "../../components/pulse/screen/pulseScreenTypes";

// A healthy company on Tue 2026-10-20 (day 20 of 31, 11 days left).
const TODAY = "2026-10-20";

type WindowOverrides = Partial<Record<SnapshotWindowKey, Partial<WindowTotals>>>;

const BASE: Partial<Record<SnapshotWindowKey, Partial<WindowTotals>>> = {
  MTD: { revenue: 30000, revenue_count: 12, cost: 18000, cost_count: 80 },
  L30: {
    revenue: 42000,
    revenue_count: 17,
    cost: 27000,
    cost_count: 120,
    cost_by_category: { payroll_contractors: 12000, fuel_equipment: 8000, operating: 5000, job_fees: 1500, other: 500 },
  },
  P30: { revenue: 38000, revenue_count: 15, cost: 26000, cost_count: 110 },
  L7: { revenue: 9000, cost: 6000, cost_by_category: { payroll_contractors: 2500, fuel_equipment: 2500, operating: 1000 } },
  // The payroll history window: 4 biweekly runs of 2,800 for the default settings.
  PAY: { cost: 11200, cost_count: 4, cost_by_category: { payroll_contractors: 11200 } },
};

/** Totals for exactly the windows the edge function would ask for (windowsForSnapshot). */
function windows(
  today: string,
  over: WindowOverrides = {},
  settings: EngineSettings | null = SETTINGS,
  countedFrom: string | null = null,
): Partial<Record<SnapshotWindowKey, WindowTotals>> {
  const out: Partial<Record<SnapshotWindowKey, WindowTotals>> = {};
  for (const w of windowsForSnapshot(today, settings, countedFrom)) {
    out[w.key] = {
      from: w.from,
      to: w.to,
      revenue: 0,
      revenue_count: 0,
      cost: 0,
      cost_count: 0,
      cost_by_category: {},
      excluded_by_reason: {},
      pending_outflow: 0,
      ...BASE[w.key],
      ...over[w.key],
    };
  }
  return out;
}

const SETTINGS: EngineSettings = {
  profit_target_monthly: null,
  cash_reserve: 2000,
  pay_frequency: "biweekly",
  pay_anchor_date: "2026-10-02",
  payroll_amount_override: null,
};

const CHECKING: BusinessAccountInput = {
  id: "acct-chk",
  name: "Business Checking",
  mask: "1111",
  type: "depository",
  include_from: null,
  history_start: "2024-10-21",
};

const CARD: BusinessAccountInput = {
  id: "acct-card",
  name: "Business Card",
  mask: "4242",
  type: "credit",
  include_from: "2026-10-07",
  history_start: "2024-10-25",
};

const hoursBefore = (now: string, h: number) => new Date(Date.parse(now) - h * 3_600_000).toISOString();

function bank(now: string, over: Partial<BankItemInput> = {}): BankItemInput {
  return {
    id: "item-1",
    institution_name: "Test Bank",
    status: "active",
    last_successful_update: hoursBefore(now, 5),
    historical_update_complete: true,
    new_accounts_available: false,
    business: true,
    ...over,
  };
}

function sched(today: string, now: string, days: Record<string, number>, over: Partial<ScheduledInput> = {}): ScheduledInput {
  return { status: "ok", fetched_at: hoursBefore(now, 1), by_day: { month_end: monthEnd(today), truncated: false, days }, ...over };
}

/** A payroll account with this cash, counted from `countedFrom` (null: not given). */
function payrollAccount(available: number, countedFrom: string | null = null): PayrollAccountInput {
  return { available, current: null, as_of: null, counted_from: countedFrom };
}

function input(over: Partial<EngineInput> = {}, win: WindowOverrides = {}): EngineInput {
  const today = over.today ?? TODAY;
  const now = over.now ?? `${today}T17:00:00Z`;
  const settings = over.settings !== undefined ? over.settings : SETTINGS;
  // The default payroll account is CHECKING, counted from its history start.
  const payrollAccounts = over.payroll_accounts ??
    [{ available: 20000, current: 21000, as_of: hoursBefore(now, 2), counted_from: accountCountedFrom(CHECKING) }];
  return {
    today,
    now,
    // As the edge function does: the PAY window for these settings and the payroll accounts' counted-from date.
    windows: windows(today, win, settings, payrollCountedFrom(payrollAccounts)),
    scheduled: sched(today, now, {}),
    settings,
    payroll_accounts: payrollAccounts,
    business_accounts: over.business_accounts ?? [CHECKING],
    bank_items: [bank(now)],
    jobber: { connected: true, disconnected: false, last_synced_at: hoursBefore(now, 0.5) },
    review_transfers_l30: 0,
    ...over,
  };
}

const codes = (s: Snapshot) => s.status.reasons.map((r) => r.code);
const warningCodes = (s: Snapshot) => s.warnings.map((w) => w.code);

function allNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allNumbers(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => allNumbers(x, out));
  return out;
}

// Synthetic payroll debits (no holidays). Paid early (lead >= 0): a weekend payday is paid the
// Friday before, and the provider debits the employer `lead` business days before that. Paid late
// (lead < 0): the debit posts -lead business days after payday (a check clearing, or Zelle posting
// the next business day).
function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function debitDate(payday: string, lead: number): string {
  if (lead < 0) {
    let late = payday;
    for (let i = 0; i < -lead; ) {
      late = addDays(late, 1);
      if (weekday(late) !== 0 && weekday(late) !== 6) i++;
    }
    return late;
  }
  const w = weekday(payday);
  let d = w === 6 ? addDays(payday, -1) : w === 0 ? addDays(payday, -2) : payday;
  for (let i = 0; i < lead; ) {
    d = addDays(d, -1);
    if (weekday(d) !== 0 && weekday(d) !== 6) i++;
  }
  return d;
}

function paydaysBetween(frequency: PayFrequency, anchor: string, from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = nextPayday(from, frequency, anchor); p <= to; p = nextPayday(addDays(p, 1), frequency, anchor)) out.push(p);
  return out;
}

/**
 * One debit of `amount` per payday from `from` to `to`, dated `lead` business days early (a
 * negative lead: that many business days late).
 */
function payrollDebits(frequency: PayFrequency, anchor: string, amount: number, lead: number, from: string, to: string) {
  return paydaysBetween(frequency, anchor, from, to).map((p) => ({ date: debitDate(p, lead), amount }));
}

/**
 * The PAY totals pulse_window_totals would return for these debits: the window windowsForSnapshot
 * asks for (with the payroll counted-from date), counting only debits posted by today and on or
 * after the counted-from date (earlier ones are before_count_from). Null when no PAY window is
 * asked for.
 */
function payFromDebits(
  debits: Array<{ date: string; amount: number }>,
  today: string,
  settings: EngineSettings,
  countedFrom: string | null,
): Partial<WindowTotals> | null {
  const pay = windowsForSnapshot(today, settings, countedFrom).find((w) => w.key === "PAY");
  if (!pay) return null;
  const inside = debits.filter((d) =>
    d.date <= today && d.date >= pay.from && d.date <= pay.to && (countedFrom === null || d.date >= countedFrom)
  );
  const total = inside.reduce((sum, d) => sum + d.amount, 0);
  return { cost: total, cost_count: inside.length, cost_by_category: { payroll_contractors: total } };
}

describe("engine basics", () => {
  it("is versioned", () => {
    const s = computeSnapshot(input());
    expect(ENGINE_VERSION).toBe("engine-7");
    expect(s.engine_version).toBe("engine-7");
    expect(s.today).toBe(TODAY);
    expect(s.computed_at).toBe("2026-10-20T17:00:00Z");
  });

  it("says what revenue is (M6): completed jobs unless the server says payments", () => {
    expect(computeSnapshot(input()).revenue_basis).toBe("completed_jobs");
    expect(computeSnapshot({ ...input(), revenue_basis: "payments" }).revenue_basis).toBe("payments");
    expect(computeSnapshot({ ...input(), revenue_basis: "completed_jobs" }).revenue_basis).toBe("completed_jobs");
    expect(computeSnapshot({ ...input(), revenue_basis: "something else" as never }).revenue_basis).toBe("completed_jobs");
  });

  it("says whether sales tax is left out (the default) or kept", () => {
    expect(computeSnapshot(input()).revenue_without_tax).toBe(true);
    expect(computeSnapshot({ ...input(), revenue_tax: "pre_tax" }).revenue_without_tax).toBe(true);
    expect(computeSnapshot({ ...input(), revenue_tax: "as_jobber" }).revenue_without_tax).toBe(false);
  });

  it("the basis changes only the label: the numbers come from the window totals either way", () => {
    const jobs = computeSnapshot(input());
    const pays = computeSnapshot({ ...input(), revenue_basis: "payments" });
    expect({ ...pays, revenue_basis: "completed_jobs" }).toEqual(jobs);
  });

  it("rounds money to cents, half away from zero, with no negative zero", () => {
    expect(money(1234.565)).toBe(1234.57);
    expect(money(-1234.565)).toBe(-1234.57);
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(money(-0.001), 0)).toBe(true);
    expect(money(Number.NaN)).toBe(0);
    expect(money(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("money() never overflows to Infinity, and a huge total cannot reach the snapshot (round-2 note)", () => {
    expect(money(1e307)).toBe(0);
    expect(money(-1e307)).toBe(0);
    expect(money(Number.MAX_VALUE)).toBe(0);
    expect(money(1e12)).toBe(1e12);
    const s = computeSnapshot(input({}, { MTD: { revenue: 1e307 }, L30: { revenue: "1e307" as unknown as number } }));
    expect(s.profit_mtd.revenue).toBe(0);
    expect(allNumbers(s).every(Number.isFinite)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/Infinity|NaN|undefined/);
  });

  it("refuses a missing today or now (a caller bug, not a data gap)", () => {
    expect(() => computeSnapshot({ ...input(), today: "2026-10-32" })).toThrow(/today/);
    expect(() => computeSnapshot({ ...input(), now: "not a time" })).toThrow(/now/);
  });
});

describe("1. profit so far this month", () => {
  it("is Rev(MTD) - Cost(MTD) over the 1st to today", () => {
    const s = computeSnapshot(input());
    expect(s.profit_mtd).toMatchObject({
      key: "MTD",
      from: "2026-10-01",
      to: "2026-10-20",
      revenue: 30000,
      revenue_count: 12,
      cost: 18000,
      cost_count: 80,
      profit: 12000,
      has_data: true,
      partial: false,
    });
  });

  it("rounds at the output only", () => {
    const s = computeSnapshot(input({}, { MTD: { revenue: 1234.565, cost: 0.1 + 0.2 } }));
    expect(s.profit_mtd.revenue).toBe(1234.57);
    expect(s.profit_mtd.cost).toBe(0.3);
    expect(s.profit_mtd.profit).toBe(1234.27);
  });
});

describe("2. last 30 vs previous 30", () => {
  it("shows revenue, costs and profit with the change in dollars and percent", () => {
    const c = computeSnapshot(input()).comparison;
    expect(c.last30).toMatchObject({ from: "2026-09-21", to: "2026-10-20", revenue: 42000, cost: 27000, profit: 15000 });
    expect(c.prev30).toMatchObject({ from: "2026-08-22", to: "2026-09-20", revenue: 38000, cost: 26000, profit: 12000 });
    expect(c.revenue).toEqual({ amount: 4000, percent: 10.5 });
    expect(c.cost).toEqual({ amount: 1000, percent: 3.8 });
    expect(c.profit).toEqual({ amount: 3000, percent: 25 });
    expect(c.comparable).toBe(true);
  });

  it("has no percent when the base is 0", () => {
    const c = computeSnapshot(input({}, { P30: { revenue: 0, cost: 0 } })).comparison;
    expect(c.revenue).toEqual({ amount: 42000, percent: null });
    expect(c.profit).toEqual({ amount: 15000, percent: null });
  });

  it("rounds percents half away from zero, the same for gains and losses", () => {
    const pct = (l30: number) => computeSnapshot(input({}, { P30: { revenue: 40000 }, L30: { revenue: l30 } })).comparison.revenue.percent;
    expect(pct(44900)).toBe(12.3);
    expect(pct(35100)).toBe(-12.3);
    expect(pct(40020)).toBe(0.1);
    expect(pct(39980)).toBe(-0.1);
    expect(pct(40000)).toBe(0);
    expect(Object.is(pct(40000), -0)).toBe(false);
  });

  it("measures change against the size of a negative base", () => {
    const c = computeSnapshot(input({}, { P30: { revenue: 1000, cost: 2000 }, L30: { revenue: 1500, cost: 1000 } })).comparison;
    expect(c.prev30.profit).toBe(-1000);
    expect(c.last30.profit).toBe(500);
    expect(c.profit).toEqual({ amount: 1500, percent: 150 });
  });
});

describe("partial windows against the latest count-from", () => {
  it("a card counted from Oct 7 makes MTD, L30 and P30 partial but not L7", () => {
    const s = computeSnapshot(input({ business_accounts: [CHECKING, CARD] }));
    expect(s.coverage).toEqual({
      counted_from: "2026-10-07",
      source: "count_from",
      account_id: "acct-card",
      label: "Business Card ending 4242 not counted before Oct 7, 2026",
    });
    expect(s.profit_mtd.partial).toBe(true);
    expect(s.profit_mtd.partial_from).toBe("2026-10-07");
    expect(s.profit_mtd.partial_label).toBe("Business Card ending 4242 not counted before Oct 7, 2026");
    expect(s.comparison.last30.partial).toBe(true);
    expect(s.comparison.prev30.partial).toBe(true);
    expect(s.comparison.comparable).toBe(false);
    expect(s.spending.L7.partial).toBe(false);
    expect(s.spending.L30.partial).toBe(true);
    expect(s.forecast.cost_rate_partial).toBe(true);
  });

  it("uses the latest date across all business accounts", () => {
    const older = { ...CARD, id: "acct-card-2", mask: "0005", include_from: "2026-09-01" };
    const s = computeSnapshot(input({ business_accounts: [older, CHECKING, CARD] }));
    expect(s.coverage.counted_from).toBe("2026-10-07");
    expect(s.coverage.account_id).toBe("acct-card");
  });

  it("a short bank history also makes windows partial, labelled as history", () => {
    const shortHistory = { ...CHECKING, history_start: "2026-09-25" };
    const s = computeSnapshot(input({ business_accounts: [shortHistory] }));
    expect(s.coverage.source).toBe("history");
    expect(s.comparison.last30.partial).toBe(true);
    expect(s.comparison.last30.partial_label).toBe("Business Checking ending 1111 history starts Sep 25, 2026");
    expect(s.profit_mtd.partial).toBe(false);
  });

  it("an account counts from the later of its count-from date and its first transaction", () => {
    const card = { ...CARD, include_from: "2026-09-01", history_start: "2026-09-10" };
    const s = computeSnapshot(input({ business_accounts: [CHECKING, card] }));
    expect(s.coverage).toMatchObject({ counted_from: "2026-09-10", source: "history" });
  });

  it("a window starting exactly on the count-from date is complete", () => {
    const s = computeSnapshot(input({ business_accounts: [{ ...CARD, include_from: "2026-10-01" }] }));
    expect(s.profit_mtd.partial).toBe(false);
    expect(s.comparison.last30.partial).toBe(true);
  });
});

describe("3. month-end forecast", () => {
  it("pace drives when the schedule is smaller", () => {
    const today = TODAY;
    const now = `${today}T17:00:00Z`;
    const f = computeSnapshot(input({ scheduled: sched(today, now, { "2026-10-25": 5000 }) })).forecast;
    expect(f).toMatchObject({
      day_of_month: 20,
      days_in_month: 31,
      days_left: 11,
      pace_basis: "month_to_date",
      pace_per_day: 1500,
      pace_rest: 16500,
      scheduled_rest: 5000,
      driver: "pace",
      pace_only: false,
      cost_per_day: 900,
      revenue: 46500,
      cost: 27900,
      profit: 18600,
    });
  });

  it("the schedule drives when it is larger; only days from today to this month's end count", () => {
    const now = `${TODAY}T17:00:00Z`;
    const days = {
      "2026-10-19": 4444,
      "2026-10-20": 9999,
      "2026-10-21": 10000,
      "2026-10-31": 12000,
      "2026-11-01": 7777,
      "not-a-date": 5,
    };
    const f = computeSnapshot(input({ scheduled: sched(TODAY, now, days) })).forecast;
    expect(f.scheduled_rest).toBe(31999);
    expect(f.driver).toBe("schedule");
    expect(f.revenue).toBe(61999);
    expect(f.profit).toBe(34099);
  });

  it("on payments (W3-10a) the pace drives: scheduled work is paid as it's done, often next month", () => {
    const now = `${TODAY}T17:00:00Z`;
    const days = { "2026-10-21": 10000, "2026-10-31": 12000 };
    const jobs = computeSnapshot(input({ scheduled: sched(TODAY, now, days) }));
    const pays = computeSnapshot(input({ scheduled: sched(TODAY, now, days), revenue_basis: "payments" }));
    expect(jobs.forecast.driver).toBe("schedule");
    expect(pays.forecast.driver).toBe("pace");
    expect(pays.forecast.pace_only).toBe(false);
    expect(pays.forecast.scheduled_rest).toBe(22000);
    expect(pays.forecast.revenue).toBeCloseTo(pays.profit_mtd.revenue + pays.forecast.pace_rest, 2);
  });

  it("a month that starts with a refund never forecasts a negative pace", () => {
    const f = computeSnapshot(input({ today: "2026-10-12", revenue_basis: "payments" }, { MTD: { revenue: -150 } })).forecast;
    expect(f.pace_per_day).toBe(0);
    expect(f.pace_rest).toBe(0);
    expect(f.revenue).toBe(-150);
  });

  it("visits still scheduled for later today count, even on the last day of the month", () => {
    const today = "2026-10-31";
    const now = `${today}T15:00:00Z`;
    const s = computeSnapshot(input(
      { today, now, scheduled: sched(today, now, { "2026-10-31": 5000 }) },
      { MTD: { revenue: 10000, cost: 12000 } },
    ));
    expect(s.forecast).toMatchObject({ days_left: 0, pace_rest: 0, scheduled_rest: 5000, driver: "schedule", revenue: 15000, profit: 3000 });
    expect(codes(s)).not.toContain("forecast_loss");
    expect(codes(s)).toEqual(["mtd_loss"]);
  });

  it("before day 10 the pace is the last 30 days' revenue per day", () => {
    const f = computeSnapshot(input({ today: "2026-10-05" }, { MTD: { revenue: 2000, cost: 1500 }, L30: { revenue: 45000 } })).forecast;
    expect(f).toMatchObject({ day_of_month: 5, days_left: 26, pace_basis: "last_30_days", pace_per_day: 1500, pace_rest: 39000, revenue: 41000 });
  });

  it("from day 10 the pace is this month's revenue per day", () => {
    const f = computeSnapshot(input({ today: "2026-10-10" }, { MTD: { revenue: 20000 } })).forecast;
    expect(f).toMatchObject({ day_of_month: 10, days_left: 21, pace_basis: "month_to_date", pace_per_day: 2000, revenue: 62000 });
  });

  it("on the last day of the month the forecast is the month so far", () => {
    const f = computeSnapshot(input({ today: "2026-10-31" }, { MTD: { revenue: 50000, cost: 30000 } })).forecast;
    expect(f).toMatchObject({ days_left: 0, revenue: 50000, cost: 30000, profit: 20000, driver: "pace" });
  });

  it("carries the truncated flag", () => {
    const now = `${TODAY}T17:00:00Z`;
    const by_day = { month_end: "2026-10-31", truncated: true, days: { "2026-10-25": 30000 } };
    const f = computeSnapshot(input({ scheduled: sched(TODAY, now, {}, { by_day }) })).forecast;
    expect(f.scheduled_truncated).toBe(true);
    expect(f.driver).toBe("schedule");
  });

  const now = `${TODAY}T17:00:00Z`;
  const big = { "2026-10-25": 99999 };
  const cases: Array<[string, ScheduledInput | null, string]> = [
    ["never fetched", null, "missing"],
    ["no status yet", sched(TODAY, now, big, { status: null }), "missing"],
    ["Jobber permission missing", sched(TODAY, now, big, { status: "no_scope", by_day: null }), "no_scope"],
    ["fetch error (old days still saved)", sched(TODAY, now, big, { status: "error" }), "fetch_error"],
    ["older than 24 h", sched(TODAY, now, big, { fetched_at: "2026-10-19T16:59:00Z" }), "stale"],
    ["cleared by a Jobber visit change", sched(TODAY, now, big, { fetched_at: null }), "changed"],
    ["saved for last month", sched(TODAY, now, big, { by_day: { month_end: "2026-09-30", truncated: false, days: big } }), "other_month"],
  ];
  for (const [label, scheduled, reason] of cases) {
    it(`falls back to pace only, labelled: ${label}`, () => {
      const s = computeSnapshot(input({ scheduled }));
      expect(s.forecast).toMatchObject({ pace_only: true, pace_only_reason: reason, driver: "pace", scheduled_rest: null, revenue: 46500 });
      expect(s.forecast.pace_only_text).toBeTruthy();
      const w = s.warnings.find((x) => x.code === "forecast_pace_only");
      expect(w?.text).toMatch(/^The forecast uses your pace only: /);
    });
  }

  it("each pace-only reason has its own text", () => {
    const text = (scheduled: ScheduledInput | null) => computeSnapshot(input({ scheduled })).forecast.pace_only_text;
    expect(text(sched(TODAY, now, big, { fetched_at: "2026-10-18T17:00:00Z" }))).toBe("scheduled visits from Jobber are more than a day old");
    expect(text(sched(TODAY, now, big, { by_day: { month_end: "2026-09-30", truncated: false, days: big } })))
      .toBe("scheduled visits have not been read for this month yet");
    expect(text(sched(TODAY, now, big, { fetched_at: null }))).toBe("scheduled visits changed in Jobber and have not been read again yet");
    expect(text(null)).toBe("scheduled visits have not been read from Jobber yet");
  });

  it("a schedule fetched exactly 24 h ago is still used", () => {
    const f = computeSnapshot(input({ scheduled: sched(TODAY, now, big, { fetched_at: "2026-10-19T17:00:00Z" }) })).forecast;
    expect(f.pace_only).toBe(false);
    expect(f.driver).toBe("schedule");
  });
});

describe("4. break-even", () => {
  it("shows what is still needed when costs are ahead of revenue", () => {
    const b = computeSnapshot(input({}, { MTD: { revenue: 5000, cost: 8000 } })).break_even;
    expect(b).toMatchObject({ covered: false, needed: 3000, ahead_by: 0, target: null, to_target: null, forecast_vs_target: null });
  });

  it("shows how far ahead once costs are covered", () => {
    const b = computeSnapshot(input()).break_even;
    expect(b).toMatchObject({ covered: true, needed: 0, ahead_by: 12000 });
  });

  it("with a target, also shows the distance to it", () => {
    const b = computeSnapshot(input({ settings: { ...SETTINGS, profit_target_monthly: 15000 } })).break_even;
    expect(b).toMatchObject({ target: 15000, to_target: 3000, forecast_vs_target: 3600 });
  });

  it("a target of 0 counts as no target", () => {
    const b = computeSnapshot(input({ settings: { ...SETTINGS, profit_target_monthly: 0 } })).break_even;
    expect(b.target).toBeNull();
  });

  it("has no answer when this month has no rows yet (not 'costs covered, $0 ahead')", () => {
    // Present, zero-valued MTD totals, as pulse_window_totals returns them for a new company.
    const settings = { ...SETTINGS, profit_target_monthly: 15000 };
    const empty = { revenue: 0, revenue_count: 0, cost: 0, cost_count: 0 };
    const s = computeSnapshot(input({ settings }, { MTD: empty }));
    expect(s.profit_mtd.has_data).toBe(true);
    expect(s.break_even).toEqual({ covered: null, needed: null, ahead_by: null, target: 15000, to_target: null, forecast_vs_target: null });
    // A missing MTD window gives the same empty state.
    const i = input({ settings });
    const { MTD: _mtd, ...rest } = i.windows;
    expect(computeSnapshot({ ...i, windows: rest }).break_even).toEqual(s.break_even);
    // One row is enough to answer.
    expect(computeSnapshot(input({ settings }, { MTD: { ...empty, cost: 50, cost_count: 1 } })).break_even)
      .toMatchObject({ covered: false, needed: 50 });
  });

  it("a brand-new company with every window present and empty: empty state, never green (round-2 finding 2)", () => {
    const now = `${TODAY}T17:00:00Z`;
    const empty = { revenue: 0, revenue_count: 0, cost: 0, cost_count: 0, cost_by_category: {} };
    const zero: WindowOverrides = { MTD: empty, L30: empty, P30: empty, L7: empty, PAY: empty };
    const fresh = computeSnapshot(input({ settings: null, jobber: { connected: true, disconnected: false, last_synced_at: hoursBefore(now, 1) } }, zero));
    expect(fresh.break_even).toMatchObject({ covered: null, needed: null, ahead_by: null });
    expect(fresh.status.level).toBe("yellow");
    expect(codes(fresh)).toEqual(["no_numbers_yet"]);
    expect(fresh.status.reasons[0].text).toBe("No revenue or costs in the last 30 days yet; numbers appear once Jobber and the bank have synced.");
    expect(fresh.warnings.find((w) => w.code === "no_numbers_yet")).toMatchObject({ severity: "warning" });
    expect(warningCodes(fresh)).not.toContain("numbers_missing");
    // Jobber connected but never synced: still not green.
    const neverSynced = computeSnapshot(input({ settings: null, jobber: { connected: true, disconnected: false, last_synced_at: null } }, zero));
    expect(neverSynced.status.level).toBe("yellow");
    expect(codes(neverSynced)).toEqual(["no_numbers_yet"]);
    expect(warningCodes(neverSynced)).toEqual(["no_numbers_yet", "jobber_stale"]);
    // A single row in the last 30 days is a number to show.
    const oneRow = computeSnapshot(input({ settings: null }, { ...zero, L30: { ...empty, cost: 20, cost_count: 1 } }));
    expect(codes(oneRow)).not.toContain("no_numbers_yet");
  });
});

describe("5. payroll safety", () => {
  // The payroll counted-from date of the default payroll account (CHECKING's history start).
  const CF = accountCountedFrom(CHECKING);

  // Payroll and contractors cost over the PAY window (the last N paydays at least A + 1 days
  // old, from 6 days before the oldest to A days after the newest): 8 weekly runs of 1,400, 4
  // biweekly of 2,800, 6 semimonthly of 3,000 or 3 monthly of 6,000. The per-run results are the
  // same as engine-1's with a complete history.
  const frequencies: Array<[PayFrequency, string, string, number, number, number, number, string, string]> = [
    ["weekly", "2026-10-02", "2026-10-23", 3, 1400, 8, 11200, "2026-08-22", "2026-10-16"],
    ["biweekly", "2026-10-02", "2026-10-30", 10, 2800, 4, 11200, "2026-08-15", "2026-10-09"],
    ["semimonthly", "2026-09-15", "2026-10-31", 11, 3000, 6, 18000, "2026-07-09", "2026-10-06"],
    ["monthly", "2026-08-31", "2026-10-31", 11, 6000, 3, 18000, "2026-06-24", "2026-09-21"],
  ];
  for (const [frequency, anchor, next, days, estimate, runs, cost, from, to] of frequencies) {
    it(`${frequency}: next payday and the estimate per pay run`, () => {
      const p = computeSnapshot(input(
        { settings: { ...SETTINGS, pay_frequency: frequency, pay_anchor_date: anchor } },
        { PAY: { cost_by_category: { payroll_contractors: cost } } },
      )).payroll;
      expect(p).toMatchObject({
        state: "covered",
        unknown_reasons: [],
        unknown_texts: [],
        next_payday: next,
        days_to_payday: days,
        estimated_payroll: estimate,
        estimate_source: "pay_history",
        history_from: from,
        history_to: to,
        history_runs: runs,
        history_cost: cost,
        estimate_partial: false,
        cash: 20000,
        reserve: 2000,
        margin: money(20000 - estimate),
      });
    });
  }

  it("monthly: a full payroll is expected whatever day of the month it is", () => {
    // $10,000 paid on the 15th, debited 2 business days early. On Oct 10, Oct 20 and Nov 5 the
    // window is Jul 9 to Oct 6 (Jul 15, Aug 15 and Sep 15; Oct 15 counts from Nov 6, A + 1 = 22
    // days after it): 3 runs either way. From Nov 6 it is Aug 9 to Nov 5.
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "monthly", pay_anchor_date: "2026-09-15" };
    const debits = payrollDebits("monthly", "2026-09-15", 10000, 2, "2026-01-01", "2026-12-31");
    const at = (today: string) => computeSnapshot(input(
      { today, settings, payroll_accounts: [payrollAccount(8000, CF)] },
      { PAY: payFromDebits(debits, today, settings, CF) ?? {} },
    ));
    const days = [
      ["2026-10-10", "2026-07-09", "2026-10-06"],
      ["2026-10-20", "2026-07-09", "2026-10-06"],
      ["2026-11-05", "2026-07-09", "2026-10-06"],
      ["2026-11-06", "2026-08-09", "2026-11-05"],
    ] as const;
    for (const [today, from, to] of days) {
      const s = at(today);
      expect(s.payroll).toMatchObject({
        state: "short",
        estimated_payroll: 10000,
        estimate_source: "pay_history",
        history_from: from,
        history_to: to,
        history_runs: 3,
        history_cost: 30000,
      });
      expect(s.status.level).toBe("red");
      expect(codes(s)).toContain("payroll_short");
    }
    expect(at("2026-10-10").payroll.next_payday).toBe("2026-10-15");
  });

  it("semimonthly: a full payroll is expected the day before payday", () => {
    // $5,000 on the 5th and the 20th, debited 3 business days early. On Oct 19 the window holds
    // the 6 paydays Jul 20 to Oct 5, and runs to Oct 11 (A = 6).
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "semimonthly", pay_anchor_date: "2026-09-05" };
    const debits = payrollDebits("semimonthly", "2026-09-05", 5000, 3, "2026-01-01", "2026-12-31");
    const s = computeSnapshot(input(
      { today: "2026-10-19", settings, payroll_accounts: [payrollAccount(4500, CF)] },
      { PAY: payFromDebits(debits, "2026-10-19", settings, CF) ?? {} },
    ));
    expect(s.payroll).toMatchObject({
      state: "short",
      estimated_payroll: 5000,
      next_payday: "2026-10-20",
      days_to_payday: 1,
      history_from: "2026-07-14",
      history_to: "2026-10-11",
      history_runs: 6,
      history_cost: 30000,
    });
    expect(s.status.level).toBe("red");
  });

  it("payroll counted from 2026-09-01, monthly on the 15th: each run counts in full, so $8,000 is short (round-2 finding 1)", () => {
    // $10,000 on the 15th, debited 2 business days early from the payroll account, which is counted
    // from Sep 1 (debits before it are not counted).
    const account: BusinessAccountInput = { ...CHECKING, include_from: "2026-09-01" };
    const from = accountCountedFrom(account);
    expect(from).toBe("2026-09-01");
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "monthly", pay_anchor_date: "2026-09-15" };
    const debits = payrollDebits("monthly", "2026-09-15", 10000, 2, "2026-01-01", "2026-12-31");
    const at = (today: string) => computeSnapshot(input(
      { today, settings, business_accounts: [account], payroll_accounts: [payrollAccount(8000, from)] },
      { PAY: payFromDebits(debits, today, settings, from) ?? {} },
    ));
    // Oct 10: the window holds only the Sep 15 run (Aug 15 - 6 days is before Sep 1).
    const oct10 = at("2026-10-10");
    expect(oct10.payroll).toMatchObject({
      state: "short",
      estimated_payroll: 10000,
      history_from: "2026-09-09",
      history_to: "2026-10-06",
      history_runs: 1,
      history_cost: 10000,
      estimate_partial: true,
    });
    expect(oct10.status.level).toBe("red");
    // Oct 20, the review's day (engine-1 read 3,333.33, covered, green): Oct 15 was paid only 5
    // days ago and counts from Nov 6, so the window holds Sep 15 alone, as the round-2 repro said.
    const oct20 = at("2026-10-20");
    expect(oct20.payroll).toMatchObject({
      state: "short",
      estimated_payroll: 10000,
      history_from: "2026-09-09",
      history_to: "2026-10-06",
      history_runs: 1,
      history_cost: 10000,
      estimate_partial: true,
    });
    expect(oct20.status.level).toBe("red");
    expect(codes(oct20)).toContain("payroll_short");
    // Nov 20 (engine-1 read 6,666.67, green): Sep 15 and Oct 15.
    expect(at("2026-11-20").payroll)
      .toMatchObject({ state: "short", estimated_payroll: 10000, history_to: "2026-11-05", history_runs: 2, estimate_partial: true });
    // Dec 20: 3 runs, a full history.
    expect(at("2026-12-20").payroll).toMatchObject({ state: "short", estimated_payroll: 10000, history_runs: 3, estimate_partial: false });
    // Semimonthly $5,000 on the 15th and the last day, $4,000 in the bank (engine-1: 1,666.67,
    // green): on Oct 20 the window holds Sep 15 and Sep 30 (Aug 31 - 6 days is before Sep 1, and
    // Oct 15 is only 5 days old).
    const semi: EngineSettings = { ...settings, pay_frequency: "semimonthly" };
    const semiDebits = payrollDebits("semimonthly", "2026-09-15", 5000, 2, "2026-01-01", "2026-12-31");
    const s = computeSnapshot(input(
      { settings: semi, business_accounts: [account], payroll_accounts: [payrollAccount(4000, from)] },
      { PAY: payFromDebits(semiDebits, TODAY, semi, from) ?? {} },
    ));
    expect(s.payroll).toMatchObject({ state: "short", estimated_payroll: 5000, history_runs: 2, history_from: "2026-09-09", history_to: "2026-10-06" });
    expect(s.status.level).toBe("red");
  });

  it("every payday predates the payroll counted-from date: unknown, partial_history, never covered or green (round-2 finding 1, round-3 finding 3)", () => {
    // Payroll counted from Oct 12, monthly on the 15th: Oct 15 - 6 days is before Oct 12.
    const account: BusinessAccountInput = { ...CHECKING, include_from: "2026-10-12" };
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "monthly", pay_anchor_date: "2026-09-15" };
    const over: Partial<EngineInput> = {
      settings,
      business_accounts: [account],
      payroll_accounts: [payrollAccount(8000, accountCountedFrom(account))],
    };
    const s = computeSnapshot(input(over));
    expect(s.payroll).toMatchObject({
      state: "unknown",
      unknown_reasons: ["partial_history"],
      unknown_texts: ["payroll history is still building; enter a typical payroll amount in setup to see this now"],
      estimated_payroll: null,
      estimate_source: null,
      history_from: null,
      history_to: null,
      history_runs: null,
      history_cost: null,
      next_payday: "2026-11-15",
      cash: 8000,
    });
    expect(PAYROLL_UNKNOWN_TEXT.partial_history).toBe(s.payroll.unknown_texts[0]);
    // The status is yellow with payroll_history_building (round-3 finding 3), and a missing PAY is
    // not numbers_missing.
    const text = "Payroll history is still building; enter a typical payroll amount in setup to check payroll safety now.";
    expect(s.status).toEqual({ level: "yellow", reasons: [{ code: "payroll_history_building", level: "yellow", text, ref: null }] });
    expect(s.warnings.find((w) => w.code === "payroll_history_building")).toMatchObject({ severity: "warning", text });
    expect(warningCodes(s)).not.toContain("numbers_missing");
    // A PAY window sent anyway is not used: the engine expects none.
    const i = input(over);
    const pay: WindowTotals = {
      from: "2026-07-09",
      to: "2026-10-15",
      revenue: 0,
      revenue_count: 0,
      cost: 30000,
      cost_count: 3,
      cost_by_category: { payroll_contractors: 30000 },
      excluded_by_reason: {},
      pending_outflow: 0,
    };
    expect(computeSnapshot({ ...i, windows: { ...i.windows, PAY: pay } }).payroll)
      .toMatchObject({ state: "unknown", unknown_reasons: ["partial_history"], estimated_payroll: null });
    // Never covered and never green until the first counted payday (Nov 15) is A + 1 = 22 days old,
    // the round-3 repro's days included (Oct 12 to Nov 14, green before), and Dec 6 too (Nov 15 is
    // then exactly 21 days old); from Dec 7 a real per-run estimate.
    const states: string[] = [];
    for (let today = "2026-10-12"; today <= "2026-12-06"; today = addDays(today, 1)) {
      const snap = computeSnapshot(input({ ...over, today }));
      states.push(`${snap.payroll.state} ${snap.payroll.unknown_reasons.join(",")} ${snap.status.level} ${codes(snap).join(",")}`);
    }
    expect([...new Set(states)]).toEqual(["unknown partial_history yellow payroll_history_building"]);
    expect(computeSnapshot(input({ ...over, today: "2026-12-07" })).payroll)
      .toMatchObject({ history_from: "2026-11-09", history_to: "2026-12-06", history_runs: 1 });
    // An override shows payroll safety now, and payroll history is not a problem any more.
    const withOverride = computeSnapshot(input({ ...over, settings: { ...settings, payroll_amount_override: 9000 } }));
    expect(withOverride.payroll).toMatchObject({ state: "short", estimated_payroll: 9000, estimate_source: "override", unknown_reasons: [] });
    expect(codes(withOverride)).toEqual(["payroll_short"]);
  });

  it("PAY totals missing or for other dates: unknown partial_history, yellow payroll_history_building, not numbers_missing", () => {
    const i = input();
    const { PAY: _pay, ...rest } = i.windows;
    const missing = computeSnapshot({ ...i, windows: rest });
    expect(missing.payroll).toMatchObject({
      state: "unknown",
      unknown_reasons: ["partial_history"],
      history_from: "2026-08-15",
      history_to: "2026-10-09",
      history_runs: 4,
      history_cost: null,
      estimated_payroll: null,
    });
    expect(warningCodes(missing)).not.toContain("numbers_missing");
    // Round-3 finding 3: no longer green.
    expect(missing.status.level).toBe("yellow");
    expect(codes(missing)).toEqual(["payroll_history_building"]);
    // Totals for another window (asked with another counted-from date) hold another number of runs.
    const shifted = { ...(i.windows.PAY as WindowTotals), from: "2026-09-12" };
    expect(computeSnapshot({ ...i, windows: { ...i.windows, PAY: shifted } }).payroll.unknown_reasons).toEqual(["partial_history"]);
    // Totals without dates are read as the expected window.
    const undated = { ...(i.windows.PAY as WindowTotals), from: undefined, to: undefined } as unknown as WindowTotals;
    expect(computeSnapshot({ ...i, windows: { ...i.windows, PAY: undated } }).payroll).toMatchObject({ state: "covered", estimated_payroll: 2800 });
    // With an override, the PAY window is not needed.
    const withOverride = computeSnapshot({ ...i, settings: { ...SETTINGS, payroll_amount_override: 3000 }, windows: rest }).payroll;
    expect(withOverride).toMatchObject({ state: "covered", estimated_payroll: 3000, estimate_source: "override", history_cost: null });
  });

  it("monthly on the 3rd, debited 2 business days early: one run every day, across the year end (round-2 finding 3)", () => {
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "monthly", pay_anchor_date: "2026-01-03" };
    const debits = payrollDebits("monthly", "2026-01-03", 10000, 2, "2025-06-01", "2027-06-30");
    // The debits the review listed: Jan 3 (a Saturday, paid Jan 2), Feb 3, Mar 3 and Apr 3.
    expect(debits.map((d) => d.date)).toEqual(expect.arrayContaining(["2025-12-31", "2026-01-30", "2026-02-27", "2026-04-01"]));
    const at = (today: string, cash: number) => computeSnapshot(input(
      { today, settings, payroll_accounts: [payrollAccount(cash, CF)] },
      { PAY: payFromDebits(debits, today, settings, CF) ?? {} },
    ));
    // Apr 10: L3M held 2 debits (6,666.67, covered, green); the aligned window holds 3 (Jan 3 to
    // Mar 3; Apr 3 is only 7 days old).
    const apr = at("2026-04-10", 8000);
    expect(apr.payroll).toMatchObject({
      state: "short",
      estimated_payroll: 10000,
      history_from: "2025-12-28",
      history_to: "2026-03-24",
      history_runs: 3,
      history_cost: 30000,
    });
    expect(apr.status.level).toBe("red");
    // Jan 10: L3M held 4 debits (13,333.33, short with 12,000); the aligned window holds 3.
    expect(at("2026-01-10", 12000).payroll).toMatchObject({ state: "covered", estimated_payroll: 10000, history_cost: 30000 });
    // Every day through 2026 and past the year end, the window holds exactly 3 debits.
    const wrong: string[] = [];
    for (let today = "2026-01-01"; today <= "2027-01-31"; today = addDays(today, 1)) {
      const p = at(today, 50000).payroll;
      if (p.estimated_payroll !== 10000 || p.history_cost !== 30000) wrong.push(`${today}: ${p.history_cost}`);
    }
    expect(wrong).toEqual([]);
  }, 30_000);

  it("weekly, biweekly and semimonthly debited 1 to 4 business days early: one run on every day", () => {
    const cases: Array<[PayFrequency, string, number]> = [
      ["weekly", "2026-10-02", 1400], // Fridays
      ["weekly", "2026-10-04", 1400], // Sundays, paid the Friday before
      ["biweekly", "2026-10-05", 2800], // Mondays
      ["semimonthly", "2026-09-05", 3000], // the 5th and the 20th
      ["semimonthly", "2026-09-15", 3000], // the 15th and the last day
    ];
    const wrong: string[] = [];
    for (const [frequency, anchor, amount] of cases) {
      const settings: EngineSettings = { ...SETTINGS, pay_frequency: frequency, pay_anchor_date: anchor };
      for (let lead = 1; lead <= 4; lead++) {
        const debits = payrollDebits(frequency, anchor, amount, lead, "2025-06-01", "2027-06-30");
        for (let today = "2026-01-01"; today <= "2027-01-31"; today = addDays(today, 3)) {
          const p = computeSnapshot(input({ today, settings }, { PAY: payFromDebits(debits, today, settings, CF) ?? {} })).payroll;
          if (p.estimated_payroll !== amount) wrong.push(`${frequency} ${anchor} lead ${lead} ${today}: ${p.estimated_payroll}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 30_000);

  it("clamps semimonthly and monthly paydays to the month end, Feb and leap years included", () => {
    const at = (today: string, frequency: EngineSettings["pay_frequency"], anchor: string) =>
      computeSnapshot(input({ today, settings: { ...SETTINGS, pay_frequency: frequency, pay_anchor_date: anchor } })).payroll.next_payday;
    expect(at("2026-02-20", "semimonthly", "2026-01-14")).toBe("2026-02-28");
    expect(at("2028-02-20", "semimonthly", "2026-01-14")).toBe("2028-02-29");
    expect(at("2026-02-10", "monthly", "2026-01-31")).toBe("2026-02-28");
    expect(at("2028-02-10", "monthly", "2026-01-31")).toBe("2028-02-29");
  });

  it("cash is the available balance, falling back to the current balance", () => {
    const p = computeSnapshot(input({
      payroll_accounts: [
        { available: 5000, current: 6000, as_of: "2026-10-20T10:00:00Z", counted_from: null },
        { available: null, current: 3000, as_of: "2026-10-20T08:00:00Z", counted_from: null },
      ],
    })).payroll;
    expect(p.cash).toBe(8000);
    expect(p.payroll_accounts).toBe(2);
    expect(p.balance_as_of).toBe("2026-10-20T08:00:00Z");
  });

  it("covered, tight and short against the reserve", () => {
    const state = (available: number) =>
      computeSnapshot(input({ payroll_accounts: [{ available, current: null, as_of: null, counted_from: null }] })).payroll.state;
    expect(state(20000)).toBe("covered");
    expect(state(4800)).toBe("covered"); // 4,800 - 2,800 = 2,000, exactly the reserve
    expect(state(4000)).toBe("tight");
    expect(state(2800)).toBe("tight");
    expect(state(2000)).toBe("short");
  });

  it("the override wins over the history estimate", () => {
    const p = computeSnapshot(input({ settings: { ...SETTINGS, payroll_amount_override: 5000 } })).payroll;
    expect(p).toMatchObject({ estimated_payroll: 5000, estimate_source: "override", margin: 15000, state: "covered", history_cost: 11200 });
  });

  it("an override of 0 or less counts as not set, so it cannot silence payroll safety", () => {
    for (const override of [0, -100, 0.004]) {
      const p = computeSnapshot(input({
        settings: { ...SETTINGS, payroll_amount_override: override },
        payroll_accounts: [{ available: 2000, current: null, as_of: null, counted_from: null }],
      })).payroll;
      expect(p).toMatchObject({ estimated_payroll: 2800, estimate_source: "pay_history", state: "short" });
    }
    const none = computeSnapshot(input({ settings: { ...SETTINGS, payroll_amount_override: 0 } }, { PAY: { cost_by_category: {} } })).payroll;
    expect(none).toMatchObject({ state: "unknown", unknown_reasons: ["no_payroll_history"], estimated_payroll: null });
  });

  it("is unknown, with the reasons, when inputs are missing", () => {
    const reasons = (over: Partial<EngineInput>, win: Parameters<typeof input>[1] = {}) => {
      const p = computeSnapshot(input(over, win)).payroll;
      expect(p.state).toBe("unknown");
      expect(p.unknown_texts).toEqual(p.unknown_reasons.map((r) => PAYROLL_UNKNOWN_TEXT[r]));
      return p.unknown_reasons;
    };
    expect(reasons({ settings: { ...SETTINGS, pay_frequency: null } })).toEqual(["no_schedule"]);
    expect(reasons({ settings: { ...SETTINGS, pay_anchor_date: null } })).toEqual(["no_schedule"]);
    expect(reasons({ payroll_accounts: [] })).toEqual(["no_payroll_account"]);
    expect(reasons({ payroll_accounts: [{ available: null, current: null, as_of: null, counted_from: null }] })).toEqual(["no_balance"]);
    expect(reasons({}, { PAY: { cost_by_category: {} } })).toEqual(["no_payroll_history"]);
    const monthly = { ...SETTINGS, pay_frequency: "monthly" as const, pay_anchor_date: "2026-09-30" };
    expect(reasons({ settings: monthly }, { PAY: { cost_by_category: { payroll_contractors: 0 } } })).toEqual(["no_payroll_history"]);
    // A payroll history that rounds to $0 a run is no history.
    expect(reasons({}, { PAY: { cost_by_category: { payroll_contractors: 0.01 } } })).toEqual(["no_payroll_history"]);
    // Payroll counted from Oct 15: the biweekly paydays old enough to count on Oct 20 (Oct 2 and
    // earlier) all have p - 6 days before it.
    expect(reasons({ payroll_accounts: [payrollAccount(20000, "2026-10-15")] })).toEqual(["partial_history"]);
    expect(reasons({ settings: null, payroll_accounts: [] })).toEqual(["no_schedule", "no_payroll_account"]);
    expect(reasons({ payroll_accounts: [] }, { PAY: { cost_by_category: {} } })).toEqual(["no_payroll_account", "no_payroll_history"]);
  });

  it("estimate_partial: fewer runs than a full history, still a per-run estimate", () => {
    // Payroll counted from Sep 12: of the biweekly paydays old enough to count on Oct 20 (Aug 21,
    // Sep 4, Sep 18 and Oct 2), only Sep 18 and Oct 2 are 6 days or more after it.
    const recent = [payrollAccount(20000, "2026-09-12")];
    const p = computeSnapshot(input({ payroll_accounts: recent }, { PAY: { cost_by_category: { payroll_contractors: 5600 } } })).payroll;
    expect(p).toMatchObject({
      estimate_partial: true,
      history_from: "2026-09-12",
      history_to: "2026-10-09",
      history_runs: 2,
      estimated_payroll: 2800,
      state: "covered",
    });
    // Counted from Aug 1: all 4 biweekly runs.
    const aug = [payrollAccount(20000, "2026-08-01")];
    expect(computeSnapshot(input({ payroll_accounts: aug })).payroll).toMatchObject({ estimate_partial: false, history_runs: 4 });
    // Monthly on the last day: Sep 30 is not 22 days old yet and Jul 31 - 6 days is before Aug 1,
    // so 1 of 3 runs (Aug 31).
    const monthly = { ...SETTINGS, pay_frequency: "monthly" as const, pay_anchor_date: "2026-09-30" };
    expect(computeSnapshot(input({ payroll_accounts: aug, settings: monthly })).payroll)
      .toMatchObject({ estimate_partial: true, history_runs: 1, history_from: "2026-08-25", history_to: "2026-09-21" });
    // Not with an override.
    const withOverride = { ...monthly, payroll_amount_override: 6000 };
    expect(computeSnapshot(input({ payroll_accounts: aug, settings: withOverride })).payroll.estimate_partial).toBe(false);
  });

  it("biweekly Fridays paid by Zelle the next business day: the full $4,000 run, so $3,500 is short (round-3 finding 1, case 1)", () => {
    // On Oct 20 the Oct 16 run posted only yesterday (Oct 19); the window holds Aug 21 to Oct 2.
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "biweekly", pay_anchor_date: "2026-10-02" };
    const debits = payrollDebits("biweekly", "2026-10-02", 4000, -1, "2026-01-01", "2026-12-31");
    expect(debits.map((d) => d.date)).toEqual(expect.arrayContaining(["2026-10-05", "2026-10-19"]));
    const s = computeSnapshot(input(
      { settings, payroll_accounts: [payrollAccount(3500, CF)] },
      { PAY: payFromDebits(debits, TODAY, settings, CF) ?? {} },
    ));
    expect(s.payroll).toMatchObject({
      state: "short",
      estimated_payroll: 4000,
      estimate_source: "pay_history",
      history_from: "2026-08-15",
      history_to: "2026-10-09",
      history_runs: 4,
      history_cost: 16000,
    });
    expect(s.status.level).toBe("red");
    expect(codes(s)).toContain("payroll_short");
  });

  it("monthly on the 15th paid by check, clearing 3 business days later: the full $10,000 run, so $8,000 is short (round-3 finding 1, case 2)", () => {
    // On Oct 20 the Oct 15 check clears today; the window holds Jul 15, Aug 15 and Sep 15.
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "monthly", pay_anchor_date: "2026-09-15" };
    const debits = payrollDebits("monthly", "2026-09-15", 10000, -3, "2026-01-01", "2026-12-31");
    expect(debits.map((d) => d.date)).toEqual(expect.arrayContaining(["2026-07-20", "2026-08-19", "2026-09-18", "2026-10-20"]));
    const s = computeSnapshot(input(
      { settings, payroll_accounts: [payrollAccount(8000, CF)] },
      { PAY: payFromDebits(debits, TODAY, settings, CF) ?? {} },
    ));
    expect(s.payroll).toMatchObject({
      state: "short",
      estimated_payroll: 10000,
      history_from: "2026-07-09",
      history_to: "2026-10-06",
      history_runs: 3,
      history_cost: 30000,
    });
    expect(s.status.level).toBe("red");
    expect(codes(s)).toContain("payroll_short");
  });

  it("on payday, with that day's debit still pending: the full run, so a dollar less is short (round-3 finding 1)", () => {
    // Monthly on the 15th, $10,000 debited on payday; on Oct 15 it has not posted yet.
    const monthly: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "monthly", pay_anchor_date: "2026-09-15" };
    const monthlyPosted = payrollDebits("monthly", "2026-09-15", 10000, 0, "2026-01-01", "2026-10-14");
    const m = computeSnapshot(input(
      { today: "2026-10-15", settings: monthly, payroll_accounts: [payrollAccount(9999, CF)] },
      { PAY: payFromDebits(monthlyPosted, "2026-10-15", monthly, CF) ?? {} },
    ));
    expect(m.payroll).toMatchObject({
      state: "short",
      estimated_payroll: 10000,
      next_payday: "2026-10-15",
      days_to_payday: 0,
      history_to: "2026-10-06",
      history_runs: 3,
    });
    expect(m.status.level).toBe("red");
    // Semimonthly on the 15th and the last day, $5,000 with $4,999 in the bank.
    const semi: EngineSettings = { ...monthly, pay_frequency: "semimonthly" };
    const semiPosted = payrollDebits("semimonthly", "2026-09-15", 5000, 0, "2026-01-01", "2026-10-14");
    const sm = computeSnapshot(input(
      { today: "2026-10-15", settings: semi, payroll_accounts: [payrollAccount(4999, CF)] },
      { PAY: payFromDebits(semiPosted, "2026-10-15", semi, CF) ?? {} },
    ));
    expect(sm.payroll).toMatchObject({ state: "short", estimated_payroll: 5000, history_runs: 6 });
    expect(sm.status.level).toBe("red");
    // Every payday from Jan 2026 to Jan 2027, every frequency: the full run on payday itself.
    const cases: Array<[PayFrequency, string, number]> = [
      ["weekly", "2026-10-02", 1400],
      ["biweekly", "2026-10-02", 2800],
      ["semimonthly", "2026-09-15", 5000],
      ["semimonthly", "2026-09-05", 5000],
      ["monthly", "2026-09-15", 10000],
      ["monthly", "2026-08-31", 10000],
    ];
    const wrong: string[] = [];
    for (const [frequency, anchor, amount] of cases) {
      const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: frequency, pay_anchor_date: anchor };
      const debits = payrollDebits(frequency, anchor, amount, 0, "2025-06-01", "2027-06-30");
      for (const payday of paydaysBetween(frequency, anchor, "2026-01-01", "2027-01-31")) {
        // The payday's own debit is still pending, so it is not in the posted rows.
        const posted = debits.filter((d) => d.date < payday);
        const p = computeSnapshot(input(
          { today: payday, settings, payroll_accounts: [payrollAccount(amount - 1, CF)] },
          { PAY: payFromDebits(posted, payday, settings, CF) ?? {} },
        )).payroll;
        if (p.estimated_payroll !== amount || p.state !== "short") wrong.push(`${frequency} ${anchor} ${payday}: ${p.estimated_payroll} ${p.state}`);
      }
    }
    expect(wrong).toEqual([]);
  }, 30_000);

  it("semimonthly, every debit clearing exactly 6 days (A) after payday, Oct 15's debit dated today and not posted yet: the full $5,000 run, so $4,999.99 is short (round-4 repro)", () => {
    // $5,000 on the 15th and the last day, each debit posting exactly 6 calendar days after payday,
    // the last day the window allows (A = 6). On Oct 21 the Oct 15 debit is dated today and has not
    // reached the data yet. Oct 15 is exactly A days old, so it is not counted: the window holds the
    // 6 runs Jul 15 to Sep 30 (Jul 9 to Oct 6), each with its debit (Jul 21 to Oct 6). Counting
    // Oct 15 (Jul 25 to Oct 21) held only 5 posted debits: 25,000 / 6 = 4,166.67, covered and green.
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "semimonthly", pay_anchor_date: "2026-09-15" };
    const debits = paydaysBetween("semimonthly", "2026-09-15", "2026-01-01", "2026-12-31").map((p) => ({ date: addDays(p, 6), amount: 5000 }));
    expect(debits.map((d) => d.date)).toEqual(expect.arrayContaining(["2026-07-21", "2026-10-06", "2026-10-21"]));
    const today = "2026-10-21";
    // Only debits dated before today have posted.
    const posted = debits.filter((d) => d.date < today);
    expect(posted.map((d) => d.date)).not.toContain("2026-10-21");
    // The payroll account has full history (CHECKING, counted from 2024-10-21).
    const pay = payFromDebits(posted, today, settings, CF);
    expect(pay).toMatchObject({ cost: 30000, cost_count: 6 });
    const s = computeSnapshot(input(
      { today, settings, payroll_accounts: [payrollAccount(4999.99, CF)] },
      { PAY: pay ?? {} },
    ));
    expect(s.payroll).toMatchObject({
      state: "short",
      unknown_reasons: [],
      estimated_payroll: 5000,
      estimate_source: "pay_history",
      estimate_partial: false,
      history_from: "2026-07-09",
      history_to: "2026-10-06",
      history_runs: 6,
      history_cost: 30000,
      cash: 4999.99,
      reserve: 0,
      margin: -0.01,
      next_payday: "2026-10-31",
      days_to_payday: 10,
    });
    expect(s.status.level).toBe("red");
    expect(codes(s)).toEqual(["payroll_short"]);
    // The next day the Oct 15 debit has posted and Oct 15 counts: Jul 25 to Oct 21, still 6 full runs.
    const next = "2026-10-22";
    const s2 = computeSnapshot(input(
      { today: next, settings, payroll_accounts: [payrollAccount(4999.99, CF)] },
      { PAY: payFromDebits(debits.filter((d) => d.date < next), next, settings, CF) ?? {} },
    ));
    expect(s2.payroll).toMatchObject({
      state: "short",
      estimated_payroll: 5000,
      history_from: "2026-07-25",
      history_to: "2026-10-21",
      history_runs: 6,
      history_cost: 30000,
    });
    expect(s2.status.level).toBe("red");
  });

  it("debits 1 to 6 days before payday or 1 and 3 business days after it: the full run on every day (round-3 finding 1)", () => {
    const cases: Array<[PayFrequency, string, number]> = [
      ["weekly", "2026-10-02", 1400], // Fridays
      ["weekly", "2026-10-04", 1400], // Sundays
      ["biweekly", "2026-10-02", 2800], // Fridays
      ["semimonthly", "2026-09-15", 3000], // the 15th and the last day
      ["semimonthly", "2026-09-05", 3000], // the 5th and the 20th
      ["monthly", "2026-09-15", 6000], // the 15th
      ["monthly", "2026-08-31", 6000], // the last day
    ];
    const wrong: string[] = [];
    for (const [frequency, anchor, amount] of cases) {
      const settings: EngineSettings = { ...SETTINGS, pay_frequency: frequency, pay_anchor_date: anchor };
      const paydays = paydaysBetween(frequency, anchor, "2025-06-01", "2027-06-30");
      const timings: Array<[string, number, Array<{ date: string; amount: number }>]> = [];
      for (let early = 1; early <= 6; early++) {
        timings.push([`${early} days early`, 3, paydays.map((p) => ({ date: addDays(p, -early), amount }))]);
      }
      for (const lag of [1, 3]) {
        timings.push([`${lag} business days late`, 1, payrollDebits(frequency, anchor, amount, -lag, "2025-06-01", "2027-06-30")]);
      }
      for (const [label, step, debits] of timings) {
        for (let today = "2026-01-01"; today <= "2027-01-31"; today = addDays(today, step)) {
          const p = computeSnapshot(input({ today, settings }, { PAY: payFromDebits(debits, today, settings, CF) ?? {} })).payroll;
          if (p.estimated_payroll !== amount) wrong.push(`${frequency} ${anchor} ${label} ${today}: ${p.estimated_payroll}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it("a card or savings account counted from recently does not hold payroll back: the payroll accounts' own date counts (round-3 finding 2)", () => {
    // CHECKING pays payroll and has two years of history; the card is counted from Oct 7 (its link
    // date). Monthly $10,000 on the 1st, debited 2 business days early, $8,000 in the bank.
    const settings: EngineSettings = { ...SETTINGS, cash_reserve: 0, pay_frequency: "monthly", pay_anchor_date: "2026-09-01" };
    const debits = payrollDebits("monthly", "2026-09-01", 10000, 2, "2024-11-01", "2027-06-30");
    const payroll = [payrollAccount(8000, accountCountedFrom(CHECKING))];
    const payrollFrom = payrollCountedFrom(payroll);
    expect(payrollFrom).toBe("2024-10-21");
    const s = computeSnapshot(input(
      { settings, business_accounts: [CHECKING, CARD], payroll_accounts: payroll },
      { PAY: payFromDebits(debits, TODAY, settings, payrollFrom) ?? {} },
    ));
    // The other windows are partial against the card's date, as before.
    expect(s.coverage.counted_from).toBe("2026-10-07");
    expect(s.comparison.last30.partial).toBe(true);
    // With the company-wide date (round 3) there was no PAY window at all: unknown and green.
    expect(windowsForSnapshot(TODAY, settings, "2026-10-07").some((w) => w.key === "PAY")).toBe(false);
    expect(s.payroll).toMatchObject({
      state: "short",
      unknown_reasons: [],
      estimated_payroll: 10000,
      estimate_partial: false,
      history_from: "2026-06-25",
      history_to: "2026-09-22",
      history_runs: 3,
      history_cost: 30000,
    });
    expect(s.status.level).toBe("red");
    expect(codes(s)).toContain("payroll_short");
    expect(codes(s)).not.toContain("payroll_history_building");
    // Every day from the card's link date, for every schedule the review listed: the full run, short.
    const cases: Array<[PayFrequency, string, number]> = [
      ["monthly", "2026-09-01", 10000],
      ["monthly", "2026-09-15", 10000],
      ["biweekly", "2026-10-02", 4000],
      ["semimonthly", "2026-09-15", 5000],
    ];
    const wrong: string[] = [];
    for (const [frequency, anchor, amount] of cases) {
      const set: EngineSettings = { ...settings, pay_frequency: frequency, pay_anchor_date: anchor };
      const runs = payrollDebits(frequency, anchor, amount, 2, "2024-11-01", "2027-06-30");
      const accounts = [payrollAccount(amount - 2000, accountCountedFrom(CHECKING))];
      for (let today = "2026-10-07"; today <= "2027-01-31"; today = addDays(today, 1)) {
        const p = computeSnapshot(input(
          { today, settings: set, business_accounts: [CHECKING, CARD], payroll_accounts: accounts },
          { PAY: payFromDebits(runs, today, set, payrollFrom) ?? {} },
        )).payroll;
        if (p.state !== "short" || p.estimated_payroll !== amount || p.estimate_partial) {
          wrong.push(`${frequency} ${anchor} ${today}: ${p.state} ${p.estimated_payroll} ${p.unknown_reasons.join(",")}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // A savings account whose history starts Oct 1 does not hold payroll back either (monthly on the last day).
    const savings: BusinessAccountInput = {
      id: "acct-sav",
      name: "Savings",
      mask: "2222",
      type: "depository",
      include_from: null,
      history_start: "2026-10-01",
    };
    const lastDay: EngineSettings = { ...settings, pay_anchor_date: "2026-08-31" };
    const lastDayDebits = payrollDebits("monthly", "2026-08-31", 10000, 2, "2024-11-01", "2027-06-30");
    const sav = computeSnapshot(input(
      { settings: lastDay, business_accounts: [CHECKING, savings], payroll_accounts: payroll },
      { PAY: payFromDebits(lastDayDebits, TODAY, lastDay, payrollFrom) ?? {} },
    ));
    expect(sav.coverage).toMatchObject({ counted_from: "2026-10-01", source: "history" });
    expect(sav.payroll).toMatchObject({ state: "short", estimated_payroll: 10000, history_runs: 3 });
    expect(sav.status.level).toBe("red");
  }, 30_000);

  it("payrollCountedFrom is the latest counted_from among the payroll accounts; accountCountedFrom the later of include_from and history_start (round-3 finding 2)", () => {
    expect(accountCountedFrom(CHECKING)).toBe("2024-10-21");
    expect(accountCountedFrom(CARD)).toBe("2026-10-07");
    expect(accountCountedFrom({ include_from: "2026-09-01", history_start: "2026-09-10" })).toBe("2026-09-10");
    expect(accountCountedFrom({ include_from: null, history_start: null })).toBeNull();
    expect(accountCountedFrom({ include_from: "2026-02-30", history_start: null })).toBeNull();
    expect(accountCountedFrom(null)).toBeNull();
    expect(payrollCountedFrom([])).toBeNull();
    expect(payrollCountedFrom(null)).toBeNull();
    expect(payrollCountedFrom([{ available: 1, current: null, as_of: null, counted_from: null }])).toBeNull();
    // Untyped data without the field at all reads as no date too.
    expect(payrollCountedFrom([{ available: 1, current: null, as_of: null } as unknown as PayrollAccountInput])).toBeNull();
    expect(payrollCountedFrom([payrollAccount(1, "2026-09-01"), payrollAccount(1, "2026-10-01"), payrollAccount(1, null)])).toBe("2026-10-01");
    expect(payrollCountedFrom([payrollAccount(1, "not a date"), null as unknown as PayrollAccountInput, payrollAccount(1, "2026-09-01")]))
      .toBe("2026-09-01");
    // The latest counts: a second payroll account counted from Oct 15 holds the biweekly history back.
    const two = [payrollAccount(10000, "2024-10-21"), payrollAccount(10000, "2026-10-15")];
    expect(computeSnapshot(input({ payroll_accounts: two })).payroll.unknown_reasons).toEqual(["partial_history"]);
    // A business account that is not a payroll account never does.
    const cardOnly = computeSnapshot(input({ business_accounts: [CHECKING, { ...CARD, include_from: "2026-10-15" }] }));
    expect(cardOnly.payroll).toMatchObject({ state: "covered", estimated_payroll: 2800, history_runs: 4 });
  });

  it("only partial_history changes the status: yellow payroll_history_building with a schedule and no override (round-3 finding 3)", () => {
    const text = "Payroll history is still building; enter a typical payroll amount in setup to check payroll safety now.";
    const i = input();
    const { PAY: _pay, ...noPay } = i.windows;
    const building = computeSnapshot({ ...i, windows: noPay });
    expect(building.status).toEqual({ level: "yellow", reasons: [{ code: "payroll_history_building", level: "yellow", text, ref: null }] });
    expect(building.warnings.filter((w) => w.code === "payroll_history_building"))
      .toEqual([{ code: "payroll_history_building", severity: "warning", text, ref: null, date: null, count: null, amount: null }]);
    // With an override payroll is checked, so there is nothing to build.
    const withOverride = computeSnapshot({ ...i, settings: { ...SETTINGS, payroll_amount_override: 3000 }, windows: noPay });
    expect(withOverride.status.level).toBe("green");
    // The other unknown reasons leave a healthy company green.
    const others: Array<[Partial<EngineInput>, string]> = [
      [{ settings: { ...SETTINGS, pay_frequency: null } }, "no_schedule"],
      [{ payroll_accounts: [] }, "no_payroll_account"],
      [{ payroll_accounts: [{ available: null, current: null, as_of: null, counted_from: null }] }, "no_balance"],
    ];
    for (const [over, reason] of others) {
      const s = computeSnapshot(input(over));
      expect(s.payroll).toMatchObject({ state: "unknown", unknown_reasons: [reason] });
      expect(s.status).toEqual({ level: "green", reasons: [] });
    }
    // No payroll cost in the PAY window (no_payroll_history) does not change it either.
    const none = computeSnapshot(input({}, { PAY: { cost_by_category: {} } }));
    expect(none.payroll.unknown_reasons).toEqual(["no_payroll_history"]);
    expect(none.status.level).toBe("green");
    // With a schedule and no PAY, partial_history shows even beside no_payroll_account.
    const both = computeSnapshot({ ...input({ payroll_accounts: [] }), windows: noPay });
    expect(both.payroll.unknown_reasons).toEqual(["no_payroll_account", "partial_history"]);
    expect(codes(both)).toEqual(["payroll_history_building"]);
    // It sits with the other data problems, after no_numbers_yet and before the bank's.
    const now = `${TODAY}T17:00:00Z`;
    const many = computeSnapshot({ ...input({ bank_items: [bank(now, { status: "error" })] }), windows: noPay });
    expect(codes(many)).toEqual(["payroll_history_building", "bank_error"]);
  });
});

describe("6. where the money goes", () => {
  it("lists categories by net cost with their share of the total", () => {
    const l30 = computeSnapshot(input()).spending.L30;
    expect(l30.total_cost).toBe(27000);
    expect(l30.categories).toEqual([
      { key: "payroll_contractors", amount: 12000, share_pct: 44.4, count: null },
      { key: "fuel_equipment", amount: 8000, share_pct: 29.6, count: null },
      { key: "operating", amount: 5000, share_pct: 18.5, count: null },
      { key: "job_fees", amount: 1500, share_pct: 5.6, count: null },
      { key: "other", amount: 500, share_pct: 1.9, count: null },
    ]);
  });

  it("L7 uses its own window; equal amounts sort by key", () => {
    const l7 = computeSnapshot(input()).spending.L7;
    expect(l7.from).toBe("2026-10-14");
    expect(l7.categories.map((c) => c.key)).toEqual(["fuel_equipment", "payroll_contractors", "operating"]);
  });

  it("lists what is not counted, by reason, in a fixed order", () => {
    const l30 = computeSnapshot(input({}, {
      L30: {
        excluded_by_reason: {
          unspecified: { total: 10, count: 1 },
          inflow: { total: -9000, count: 4 },
          personal: { total: 800, count: 3 },
          card_payment: { total: 0, count: 6 },
        },
        pending_outflow: 245.5,
      },
    })).spending.L30;
    expect(l30.not_counted).toEqual([
      { reason: "card_payment", label: "Card payments", total: 0, count: 6, money_out: 0, count_out: 0, money_in: 0, count_in: 0 },
      { reason: "personal", label: "Personal or owner draw", total: 800, count: 3, money_out: 800, count_out: 3, money_in: 0, count_in: 0 },
      { reason: "inflow", label: "Money in (revenue comes from Jobber)", total: -9000, count: 4, money_out: 0, count_out: 0, money_in: 9000, count_in: 4 },
      { reason: "unspecified", label: "Other items not counted", total: 10, count: 1, money_out: 10, count_out: 1, money_in: 0, count_in: 0 },
    ]);
    expect(l30.pending_outflow).toBe(245.5);
  });

  it("the pending line shows pending money out only, like the pending warning", () => {
    const s = computeSnapshot(input({}, {
      L30: { excluded_by_reason: { pending: { total: -2500, count: 2 } }, pending_outflow: 500 },
    }));
    expect(s.spending.L30.not_counted).toEqual([{
      reason: "pending", label: "Pending, not counted yet", total: 500, count: 2, money_out: 500, count_out: 2, money_in: 2500, count_in: 2,
    }]);
    expect(s.warnings.find((w) => w.code === "pending_not_counted")?.text).toBe("$500.00 pending, not counted yet.");
  });

  it("the pending warning and the L30 pending line use the same window, L30 (round-2 note)", () => {
    // The L7 screen keeps its own window's pending line.
    const s = computeSnapshot(input({}, {
      L30: { excluded_by_reason: { pending: { total: 300, count: 3 } }, pending_outflow: 300 },
      L7: { excluded_by_reason: { pending: { total: 120, count: 1 } }, pending_outflow: 120 },
    }));
    const line = s.spending.L30.not_counted.find((l) => l.reason === "pending");
    const w = s.warnings.find((x) => x.code === "pending_not_counted");
    expect(line?.total).toBe(300);
    expect(w).toMatchObject({ amount: 300, text: "$300.00 pending, not counted yet." });
    expect(s.spending.L7.not_counted).toEqual([{
      reason: "pending", label: "Pending, not counted yet", total: 120, count: 1, money_out: 120, count_out: 1, money_in: 0, count_in: 0,
    }]);
  });

  it("has no shares when there is no cost", () => {
    const l7 = computeSnapshot(input({}, { L7: { cost: 0, cost_by_category: { operating: 0 } } })).spending.L7;
    expect(l7.categories).toEqual([{ key: "operating", amount: 0, share_pct: null, count: null }]);
  });

  it("with M5 totals: payments per category, and money out and money in kept apart (engine-3)", () => {
    const l30 = computeSnapshot(input({}, {
      L30: {
        cost_count_by_category: { payroll_contractors: 4, fuel_equipment: 31 },
        excluded_by_reason: {
          card_payment: { total: 0, count: 2 },
          inflow: { total: -9000, count: 4 },
          pending: { total: -2250, count: 3 },
        },
        excluded_flow_by_reason: {
          card_payment: { out: 1250, out_count: 1, in: 1250, in_count: 1 },
          inflow: { out: 0, out_count: 0, in: 9000, in_count: 4 },
          pending: { out: 250, out_count: 2, in: 2500, in_count: 1 },
        },
        pending_outflow: 250,
      },
    })).spending.L30;
    expect(l30.categories.find((c) => c.key === "payroll_contractors")?.count).toBe(4);
    expect(l30.categories.find((c) => c.key === "fuel_equipment")?.count).toBe(31);
    // A category the counts do not name has 0 payments, not null, once counts are there.
    expect(l30.categories.find((c) => c.key === "operating")?.count).toBe(0);
    const card = l30.not_counted.find((l) => l.reason === "card_payment");
    expect(card).toMatchObject({ total: 0, money_out: 1250, count_out: 1, money_in: 1250, count_in: 1 });
    expect(l30.not_counted.find((l) => l.reason === "inflow")).toMatchObject({ money_out: 0, money_in: 9000, count_in: 4 });
    expect(l30.not_counted.find((l) => l.reason === "pending")).toMatchObject({ total: 250, money_out: 250, count_out: 2 });
  });

  it("garbage in the M5 fields never becomes NaN or a negative amount", () => {
    const l30 = computeSnapshot(input({}, {
      L30: {
        cost_count_by_category: { fuel_equipment: "x" as unknown as number },
        excluded_by_reason: { personal: { total: 50, count: 1 } },
        excluded_flow_by_reason: { personal: { out: -5, out_count: -1, in: Number.NaN, in_count: 2.7 } },
      },
    })).spending.L30;
    expect(l30.categories.find((c) => c.key === "fuel_equipment")?.count).toBe(0);
    expect(l30.not_counted[0]).toMatchObject({ money_out: 0, money_in: 0 });
    expect(Number.isFinite(l30.not_counted[0].count_out)).toBe(true);
  });
});

describe("the 7 / 14 / 30 day period filter (engine-3)", () => {
  it("each period compares the last N days with the N days before", () => {
    const s = computeSnapshot(input({}, {
      L14: { revenue: 20000, cost: 12000, cost_by_category: { fuel_equipment: 12000 } },
      P14: { revenue: 16000, cost: 12000 },
      P7: { revenue: 8000, cost: 7000 },
    }));
    expect(Object.keys(s.periods)).toEqual(["7", "14", "30"]);
    const p14 = s.periods["14"];
    expect(p14.days).toBe(14);
    expect(p14.last).toMatchObject({ key: "L14", from: "2026-10-07", to: "2026-10-20", profit: 8000 });
    expect(p14.prev).toMatchObject({ key: "P14", from: "2026-09-23", to: "2026-10-06", profit: 4000 });
    expect(p14.revenue).toEqual({ amount: 4000, percent: 25 });
    expect(p14.profit).toEqual({ amount: 4000, percent: 100 });
    expect(p14.spending.key).toBe("L14");
    expect(p14.spending.categories.map((c) => c.key)).toEqual(["fuel_equipment"]);
    const p7 = s.periods["7"];
    expect(p7.last.key).toBe("L7");
    expect(p7.prev).toMatchObject({ key: "P7", from: "2026-10-07", to: "2026-10-13" });
    // The 30-day period is the same comparison the snapshot always had.
    expect(s.periods["30"].revenue).toEqual(s.comparison.revenue);
    expect(s.periods["30"].spending).toEqual(s.spending.L30);
  });

  it("missing 7 or 14 day totals show no data and never change the status", () => {
    const inp = input();
    delete inp.windows.L14;
    delete inp.windows.P7;
    const s = computeSnapshot(inp);
    expect(s.periods["14"].last.has_data).toBe(false);
    expect(s.periods["7"].prev.has_data).toBe(false);
    expect(s.status.reasons.map((r) => r.code)).not.toContain("numbers_missing");
  });

  it("a period is not comparable when either window starts before the count-from date", () => {
    const s = computeSnapshot(input({
      business_accounts: [{ id: "c1", name: "Card", mask: "4417", type: "credit", include_from: "2026-10-01", history_start: "2026-09-01" }],
    }));
    expect(s.periods["14"].comparable).toBe(false);
    expect(s.periods["7"].comparable).toBe(true);
  });
});

describe("status", () => {
  it("green when everything is fine and fresh", () => {
    const s = computeSnapshot(input());
    expect(s.status).toEqual({ level: "green", reasons: [] });
  });

  it("red when payroll is short", () => {
    const s = computeSnapshot(input({ payroll_accounts: [{ available: 2000, current: null, as_of: null, counted_from: null }] }));
    expect(s.status.level).toBe("red");
    expect(codes(s)).toEqual(["payroll_short"]);
  });

  it("red when the forecast is a loss from day 10", () => {
    const s = computeSnapshot(input({ today: "2026-10-12" }, { MTD: { revenue: 10000, cost: 12000 }, L30: { revenue: 30000, cost: 36000 } }));
    expect(s.forecast.profit).toBe(-8966.67);
    expect(s.status.level).toBe("red");
    expect(codes(s)).toContain("forecast_loss");
    expect(codes(s)).not.toContain("mtd_loss");
  });

  it("a forecast loss is yellow on day 9 and red on day 10", () => {
    const win = { MTD: { revenue: 10000, cost: 12000 }, L30: { revenue: 30000, cost: 36000 }, P30: { revenue: 30000, cost: 36000 } };
    const day9 = computeSnapshot(input({ today: "2026-10-09" }, win));
    expect(day9.forecast.profit).toBe(-6400);
    expect(day9.status.level).toBe("yellow");
    expect(codes(day9)).toEqual(["forecast_loss_early"]);
    const day10 = computeSnapshot(input({ today: "2026-10-10" }, win));
    expect(day10.forecast.profit).toBe(-6200);
    expect(day10.status.level).toBe("red");
    expect(codes(day10)).toEqual(["forecast_loss"]);
  });

  it("only yellow for a forecast loss before day 10", () => {
    const s = computeSnapshot(input({ today: "2026-10-05" }, { MTD: { revenue: 2000, cost: 6000 }, L30: { revenue: 30000, cost: 36000 } }));
    expect(s.forecast.profit).toBe(-9200);
    expect(s.status.level).toBe("yellow");
    expect(codes(s)).toContain("forecast_loss_early");
    expect(codes(s)).not.toContain("forecast_loss");
  });

  it("red when profit so far is negative from day 20, not before", () => {
    const win = { MTD: { revenue: 10000, cost: 11000 }, L30: { revenue: 40000, cost: 3000 } };
    const day20 = computeSnapshot(input({ today: "2026-10-20" }, win));
    expect(day20.forecast.profit).toBeGreaterThan(0);
    expect(day20.status.level).toBe("red");
    expect(codes(day20)).toEqual(["mtd_loss"]);
    const day19 = computeSnapshot(input({ today: "2026-10-19" }, win));
    expect(codes(day19)).not.toContain("mtd_loss");
    expect(day19.status.level).toBe("green");
  });

  it("yellow when payroll is tight", () => {
    const s = computeSnapshot(input({ payroll_accounts: [{ available: 4000, current: null, as_of: null, counted_from: null }] }));
    expect(s.status.level).toBe("yellow");
    expect(codes(s)).toEqual(["payroll_tight"]);
  });

  it("yellow when the forecast is below the target", () => {
    const s = computeSnapshot(input({ settings: { ...SETTINGS, profit_target_monthly: 20000 } }));
    expect(s.status.level).toBe("yellow");
    expect(codes(s)).toEqual(["forecast_below_target"]);
  });

  it("yellow when last-30 profit is under 80% of the previous 30, only when neither window is partial", () => {
    const win = { L30: { revenue: 30000, cost: 27000 }, P30: { revenue: 38000, cost: 26000 } };
    const full = computeSnapshot(input({}, win));
    expect(full.status.level).toBe("yellow");
    expect(codes(full)).toEqual(["profit_down"]);
    expect(full.status.reasons[0].text).toBe("Profit in the last 30 days is down 75% from the 30 days before.");
    const partial = computeSnapshot(input({ business_accounts: [CHECKING, CARD] }, win));
    expect(codes(partial)).not.toContain("profit_down");
    expect(partial.status.level).toBe("green");
  });

  it("exactly 80% of the previous profit is not below 80%, a cent less is", () => {
    const at = (l30: number) => computeSnapshot(input({}, { L30: { revenue: l30, cost: 0 }, P30: { revenue: 1000.35, cost: 0 } }));
    expect(codes(at(800.28))).toEqual([]);
    expect(codes(at(800.27))).toEqual(["profit_down"]);
    // A 20.001% drop fires, and its text never reads "down 20%" (round-2 note).
    expect(at(800.27).status.reasons[0].text).toBe("Profit in the last 30 days is down 20.1% from the 30 days before.");
    // Every cent-exact 80% pair up to $2,000 (floating point once made thousands of these fire).
    const wrong: number[] = [];
    for (let p = 5; p <= 200000; p += 5) {
      const l = (p / 5) * 4;
      if (profitDropped(l / 100, p / 100) || !profitDropped((l - 1) / 100, p / 100)) wrong.push(p);
    }
    expect(wrong).toEqual([]);
  });

  it("the percent in the profit_down text is rounded up to one decimal and always above 20", () => {
    expect(shownProfitDrop(800.27, 1000.35)).toBe(20.1);
    expect(shownProfitDrop(3000, 12000)).toBe(75);
    expect(shownProfitDrop(7499, 10000)).toBe(25.1); // 25.01%
    expect(shownProfitDrop(7490, 10000)).toBe(25.1); // exactly 25.1%
    expect(shownProfitDrop(7489, 10000)).toBe(25.2); // 25.11%
    expect(shownProfitDrop(-500, 1000)).toBe(150);
    // Every cent-exact drop that fires, from a P30 profit of $1 to $50: never 20 or less, never
    // below the true drop, and less than 0.1 above it.
    const wrong: string[] = [];
    for (let p = 100; p <= 5000; p += 7) {
      for (let l = Math.floor(p * 0.8) - 3; l <= Math.floor(p * 0.8) + 1; l++) {
        if (!profitDropped(l / 100, p / 100)) continue;
        const shown = shownProfitDrop(l / 100, p / 100);
        const truth = ((p - l) / p) * 100;
        if (shown <= 20 || shown < truth - 1e-9 || shown - truth >= 0.1 + 1e-9) wrong.push(`${l}/${p}: ${shown}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("after a loss or a break-even, yellow when the loss grows by more than 20% or a loss follows break-even", () => {
    const at = (l30: [number, number], p30: [number, number]) =>
      computeSnapshot(input({}, { L30: { revenue: l30[0], cost: l30[1] }, P30: { revenue: p30[0], cost: p30[1] } }));
    // Loss of 1,000 grew to 20,000.
    const deeper = at([20000, 40000], [10000, 11000]);
    expect(deeper.status.level).toBe("yellow");
    expect(codes(deeper)).toEqual(["profit_down"]);
    expect(deeper.status.reasons[0].text).toBe("Profit in the last 30 days is -$20,000.00, down from -$1,000.00 in the 30 days before.");
    // Break-even, then a loss.
    expect(codes(at([20000, 40000], [5000, 5000]))).toEqual(["profit_down"]);
    // A loss of 1,000 grew by exactly 20%, by 10%, or shrank: no drop.
    expect(codes(at([1000, 2200], [1000, 2000]))).toEqual([]);
    expect(codes(at([1000, 2200.01], [1000, 2000]))).toEqual(["profit_down"]);
    expect(codes(at([1000, 2100], [1000, 2000]))).toEqual([]);
    expect(codes(at([1000, 1900], [1000, 2000]))).toEqual([]);
    // Break-even after break-even, or a profit after a loss: no drop.
    expect(codes(at([5000, 5000], [5000, 5000]))).toEqual([]);
    expect(codes(at([6000, 5000], [1000, 2000]))).toEqual([]);
  });

  describe("never green on stale or broken data", () => {
    const now = `${TODAY}T17:00:00Z`;
    const cases: Array<[string, Partial<EngineInput>, string]> = [
      ["bank needs login", { bank_items: [bank(now, { status: "login_required" })] }, "bank_login_required"],
      ["bank access revoked", { bank_items: [bank(now, { status: "revoked" })] }, "bank_revoked"],
      ["bank in error", { bank_items: [bank(now, { status: "error" })] }, "bank_error"],
      ["no bank update for more than 72 h", { bank_items: [bank(now, { last_successful_update: hoursBefore(now, 73) })] }, "bank_stale"],
      ["bank never updated", { bank_items: [bank(now, { last_successful_update: null })] }, "bank_stale"],
      ["Jobber disconnected", { jobber: { connected: false, disconnected: true, last_synced_at: hoursBefore(now, 1) } }, "jobber_disconnected"],
      ["Jobber never connected", { jobber: null }, "jobber_not_connected"],
      ["no business bank linked", { bank_items: [] }, "no_bank_linked"],
    ];
    for (const [label, over, code] of cases) {
      it(`${label}: green becomes yellow with the reason`, () => {
        const s = computeSnapshot(input(over));
        expect(s.status.level).toBe("yellow");
        expect(codes(s)).toEqual([code]);
        expect(s.status.reasons[0].text.length).toBeGreaterThan(10);
      });
    }

    it("window totals missing or keyed wrongly: never green, with the reason", () => {
      // A company with weekly payroll and 500 in the bank.
      const over: Partial<EngineInput> = {
        settings: { ...SETTINGS, pay_frequency: "weekly" },
        payroll_accounts: [{ available: 500, current: null, as_of: null, counted_from: null }],
      };
      const win = { MTD: { revenue: 1000, cost: 5000 }, L30: { revenue: 1000, cost: 9000 } };
      const good = computeSnapshot(input(over, win));
      expect(good.status.level).toBe("red");
      expect(codes(good)).not.toContain("numbers_missing");
      // The same totals under lower-case keys are not read at all (PAY neither, so payroll
      // history reads as still building).
      const lower = Object.fromEntries(Object.entries(input(over, win).windows).map(([k, v]) => [k.toLowerCase(), v]));
      const bad = computeSnapshot({ ...input(over), windows: lower as unknown as EngineInput["windows"] });
      expect(bad.status.level).not.toBe("green");
      expect(codes(bad)).toEqual(["numbers_missing", "payroll_history_building"]);
      expect(bad.profit_mtd.has_data).toBe(false);
      expect(bad.warnings.find((w) => w.code === "numbers_missing")?.text).toBe("Some totals could not be read, so some numbers show $0 for now.");
      // One window missing is enough.
      const i = input();
      const { L7: _l7, ...rest } = i.windows;
      expect(codes(computeSnapshot({ ...i, windows: rest }))).toEqual(["numbers_missing"]);
      // PAY is optional: without it payroll is unknown (partial_history, so payroll_history_building),
      // but no number is missing.
      const { PAY: _pay, ...noPay } = i.windows;
      const s = computeSnapshot({ ...i, windows: noPay });
      expect(codes(s)).toEqual(["payroll_history_building"]);
      expect(s.payroll.unknown_reasons).toEqual(["partial_history"]);
    });

    it("72 h exactly is not yet stale", () => {
      const s = computeSnapshot(input({ bank_items: [bank(now, { last_successful_update: hoursBefore(now, 72) })] }));
      expect(s.status.level).toBe("green");
      // One minute over is stale, even though it still displays as 72.0 hours.
      const over = computeSnapshot(input({ bank_items: [bank(now, { last_successful_update: hoursBefore(now, 72 + 1 / 60) })] }));
      expect(over.freshness.banks[0].hours_since_update).toBe(72);
      expect(codes(over)).toEqual(["bank_stale"]);
    });

    it("a red status stays red and still lists the data problem", () => {
      const s = computeSnapshot(input({
        payroll_accounts: [{ available: 1000, current: null, as_of: null, counted_from: null }],
        bank_items: [bank(now, { status: "login_required", last_successful_update: hoursBefore(now, 100) })],
      }));
      expect(s.status.level).toBe("red");
      expect(codes(s)).toEqual(["payroll_short", "bank_login_required", "bank_stale"]);
      expect(s.status.reasons.find((r) => r.code === "bank_login_required")?.ref).toBe("item-1");
    });

    it("ignores items that hold no business account, and removed items", () => {
      const s = computeSnapshot(input({
        bank_items: [
          bank(now),
          bank(now, { id: "item-personal", status: "login_required", business: false }),
          bank(now, { id: "item-gone", status: "removed", last_successful_update: null }),
        ],
      }));
      expect(s.status.level).toBe("green");
      expect(s.freshness.banks.map((b) => b.id)).toEqual(["item-1"]);
    });

    it("access expiring soon only warns", () => {
      const s = computeSnapshot(input({ bank_items: [bank(now, { status: "pending_expiration" })] }));
      expect(s.status.level).toBe("green");
      expect(warningCodes(s)).toContain("bank_expiring");
    });

    it("Jobber data older than 24 h only warns", () => {
      const s = computeSnapshot(input({ jobber: { connected: true, disconnected: false, last_synced_at: hoursBefore(now, 26) } }));
      expect(s.status.level).toBe("green");
      expect(warningCodes(s)).toEqual(["jobber_stale"]);
    });
  });

  it("returns every reason that fired", () => {
    const now = `${TODAY}T17:00:00Z`;
    const s = computeSnapshot(input(
      {
        payroll_accounts: [{ available: 4000, current: null, as_of: null, counted_from: null }],
        settings: { ...SETTINGS, profit_target_monthly: 50000 },
        bank_items: [bank(now, { status: "error" })],
        jobber: { connected: false, disconnected: true, last_synced_at: null },
      },
      { MTD: { revenue: 10000, cost: 11000 }, L30: { revenue: 40000, cost: 3000 } },
    ));
    expect(s.status.level).toBe("red");
    expect(codes(s)).toEqual(["mtd_loss", "payroll_tight", "forecast_below_target", "bank_error", "jobber_disconnected"]);
  });
});

describe("warnings", () => {
  const now = `${TODAY}T17:00:00Z`;

  it("bank warnings carry the item id", () => {
    const s = computeSnapshot(input({
      bank_items: [bank(now, { status: "login_required", historical_update_complete: false, new_accounts_available: true })],
    }));
    expect(s.warnings.filter((w) => w.ref === "item-1").map((w) => [w.code, w.severity])).toEqual([
      ["bank_login_required", "action"],
      ["bank_history_loading", "info"],
      ["bank_new_accounts", "info"],
    ]);
    expect(s.warnings[0].text).toBe("Test Bank needs you to log in again.");
  });

  it("stale banks say for how long", () => {
    const s = computeSnapshot(input({ bank_items: [bank(now, { institution_name: null, last_successful_update: hoursBefore(now, 100) })] }));
    expect(s.warnings.find((w) => w.code === "bank_stale")?.text).toBe("Your bank has not updated for 4 days.");
  });

  it("card and account count-from dates", () => {
    const s = computeSnapshot(input({ business_accounts: [{ ...CHECKING, include_from: "2026-01-01" }, CARD] }));
    const card = s.warnings.find((w) => w.code === "card_counted_from");
    expect(card).toMatchObject({ ref: "acct-card", date: "2026-10-07", text: "Business Card ending 4242 counted from Oct 7, 2026." });
    expect(s.warnings.find((w) => w.code === "account_counted_from")?.date).toBe("2026-01-01");
  });

  it("transfers to unlinked accounts that were counted", () => {
    const many = computeSnapshot(input({ review_transfers_l30: 3 })).warnings.find((w) => w.code === "transfers_review");
    expect(many).toMatchObject({ count: 3, severity: "warning" });
    expect(many?.text).toBe("3 transfers to accounts that are not linked were counted as costs in the last 30 days. Review them.");
    const one = computeSnapshot(input({ review_transfers_l30: 1 })).warnings.find((w) => w.code === "transfers_review");
    expect(one?.text).toBe("1 transfer to accounts that are not linked was counted as costs in the last 30 days. Review them.");
  });

  it("pending total, not counted yet", () => {
    const s = computeSnapshot(input({}, { L30: { pending_outflow: 1432.1 } }));
    expect(s.warnings.find((w) => w.code === "pending_not_counted")).toMatchObject({
      amount: 1432.1,
      text: "$1,432.10 pending, not counted yet.",
    });
  });

  it("Jobber not connected or disconnected", () => {
    expect(warningCodes(computeSnapshot(input({ jobber: null })))).toEqual(["jobber_not_connected"]);
    expect(warningCodes(computeSnapshot(input({ jobber: { connected: true, disconnected: true, last_synced_at: null } }))))
      .toEqual(["jobber_disconnected"]);
  });

  it("every text is plain ASCII", () => {
    const s = computeSnapshot(input({
      business_accounts: [CHECKING, CARD],
      bank_items: [bank(now, { status: "login_required", historical_update_complete: false, new_accounts_available: true })],
      review_transfers_l30: 2,
      scheduled: null,
      payroll_accounts: [{ available: 1000, current: null, as_of: null, counted_from: null }],
    }, { L30: { pending_outflow: 12 } }));
    expect(s.warnings.length).toBeGreaterThan(5);
    expect(JSON.stringify(s)).toMatch(/^[\x20-\x7E]*$/);
  });
});

describe("time zones", () => {
  it("2026-10-01T03:30Z counts as Sep 30 in Chicago: September's last day, nothing left", () => {
    const now = "2026-10-01T03:30:00Z";
    const today = localDate(now, "America/Chicago");
    expect(today).toBe("2026-09-30");
    const s = computeSnapshot(input({
      today,
      now,
      scheduled: sched(today, now, { "2026-09-30": 800, "2026-10-01": 5000 }),
    }));
    expect(s.profit_mtd.from).toBe("2026-09-01");
    expect(s.profit_mtd.to).toBe("2026-09-30");
    // Only Sep 30's visits still to come count; Oct 1 is next month.
    expect(s.forecast).toMatchObject({ day_of_month: 30, days_in_month: 30, days_left: 0, scheduled_rest: 800, driver: "schedule", revenue: 30800 });
  });

  it("just after midnight on the 1st, last month's schedule is not used", () => {
    const now = "2026-10-01T05:30:00Z"; // 00:30 in Chicago
    const today = localDate(now, "America/Chicago");
    expect(today).toBe("2026-10-01");
    const s = computeSnapshot(input({
      today,
      now,
      scheduled: { status: "ok", fetched_at: "2026-10-01T04:00:00Z", by_day: { month_end: "2026-09-30", truncated: false, days: { "2026-09-30": 800 } } },
    }));
    expect(s.forecast).toMatchObject({ pace_only: true, pace_only_reason: "other_month", pace_basis: "last_30_days", day_of_month: 1 });
    expect(s.forecast.pace_only_text).toBe("scheduled visits have not been read for this month yet");
  });

  it("daylight saving ends 2026-11-01: windows stay whole days, staleness uses real hours", () => {
    const now = "2026-11-02T05:30:00Z"; // 23:30 on Nov 1 in Chicago (back on UTC-6)
    const today = localDate(now, "America/Chicago");
    expect(today).toBe("2026-11-01");
    const fresh = computeSnapshot(input({
      today,
      now,
      bank_items: [bank(now, { last_successful_update: "2026-10-30T05:45:00Z" })],
      settings: { ...SETTINGS, pay_frequency: "weekly", pay_anchor_date: "2026-10-30" },
    }));
    expect(fresh.spending.L7.from).toBe("2026-10-26");
    expect(fresh.comparison.last30.from).toBe("2026-10-03");
    expect(fresh.freshness.banks[0].hours_since_update).toBe(71.8);
    expect(fresh.payroll.next_payday).toBe("2026-11-06");
    expect(fresh.status.level).toBe("green");
    const stale = computeSnapshot(input({ today, now, bank_items: [bank(now, { last_successful_update: "2026-10-30T05:00:00Z" })] }));
    expect(codes(stale)).toEqual(["bank_stale"]);
  });
});

describe("empty and messy inputs", () => {
  it("a brand-new company: no crash, sensible unknowns", () => {
    const s = computeSnapshot({
      today: TODAY,
      now: "2026-10-20T17:00:00Z",
      windows: {},
      scheduled: null,
      settings: null,
      payroll_accounts: [],
      business_accounts: [],
      bank_items: [],
      jobber: null,
      review_transfers_l30: null,
    });
    expect(s.status.level).toBe("yellow");
    expect(codes(s)).toEqual(["numbers_missing", "no_bank_linked", "jobber_not_connected"]);
    expect(s.profit_mtd).toMatchObject({ from: "2026-10-01", to: TODAY, revenue: 0, cost: 0, profit: 0, has_data: false, partial: false });
    expect(s.comparison.profit.percent).toBeNull();
    expect(s.forecast).toMatchObject({ revenue: 0, cost: 0, profit: 0, pace_only: true, pace_only_reason: "missing" });
    expect(s.break_even).toMatchObject({ covered: null, needed: null, ahead_by: null });
    expect(s.payroll).toMatchObject({ state: "unknown", unknown_reasons: ["no_schedule", "no_payroll_account"], next_payday: null, cash: null });
    expect(s.spending.L30.categories).toEqual([]);
    expect(s.coverage.counted_from).toBeNull();
    expect(allNumbers(s).every(Number.isFinite)).toBe(true);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("garbage numbers never become NaN or Infinity", () => {
    const junk = {
      from: "2026-10-01",
      to: TODAY,
      revenue: Number.NaN,
      revenue_count: Number.POSITIVE_INFINITY,
      cost: "abc",
      cost_count: null,
      cost_by_category: { operating: Number.NEGATIVE_INFINITY, fuel_equipment: "1234.50" },
      excluded_by_reason: { personal: { total: Number.NaN, count: "x" }, broken: null },
      pending_outflow: undefined,
    } as unknown as WindowTotals;
    const s = computeSnapshot(input(
      {
        settings: { ...SETTINGS, pay_frequency: "fortnightly" as EngineSettings["pay_frequency"], cash_reserve: Number.NaN },
        payroll_accounts: [{ available: Number.NaN, current: Number.POSITIVE_INFINITY, as_of: "garbage", counted_from: null }],
        review_transfers_l30: Number.NaN,
      },
      {},
    ));
    const s2 = computeSnapshot({ ...input(), windows: { MTD: junk, L30: junk, P30: junk, L7: junk, PAY: junk } });
    for (const snap of [s, s2]) {
      expect(allNumbers(snap).every(Number.isFinite)).toBe(true);
      expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    }
    expect(s.payroll.state).toBe("unknown");
    expect(s2.spending.L30.categories).toEqual([{ key: "fuel_equipment", amount: 1234.5, share_pct: null, count: null }]);
    expect(s2.profit_mtd.revenue).toBe(0);
  });
});

describe("the month comparison and Home's summary (engine-6)", () => {
  it("compares this month so far with the same days of last month", () => {
    const s = computeSnapshot(input({}, { PMTD: { revenue: 25000, revenue_count: 10, cost: 20000, cost_count: 70 } }));
    expect(s.month.current).toMatchObject({ key: "MTD", from: "2026-10-01", to: "2026-10-20", revenue: 30000, cost: 18000, profit: 12000 });
    expect(s.month.previous).toMatchObject({ key: "PMTD", from: "2026-09-01", to: "2026-09-20", revenue: 25000, cost: 20000, profit: 5000 });
    expect(s.month.revenue).toEqual({ amount: 5000, percent: 20 });
    expect(s.month.cost).toEqual({ amount: -2000, percent: -10 });
    expect(s.month.profit).toEqual({ amount: 7000, percent: 140 });
    expect(s.month.comparable).toBe(true);
    // The month view is the same summary the rest of the snapshot uses for MTD.
    expect(s.month.current).toEqual(s.profit_mtd);
  });

  it("a missing PMTD window shows no data and doesn't change the status", () => {
    const base = input();
    const { PMTD: _dropped, ...rest } = base.windows as Record<string, WindowTotals>;
    const s = computeSnapshot({ ...base, windows: rest });
    expect(s.month.previous.has_data).toBe(false);
    expect(codes(s)).not.toContain("numbers_missing");
    expect(s.status.level).toBe(computeSnapshot(base).status.level);
  });

  it("isn't like for like while an account is counted from inside either window", () => {
    // The card counted from Oct 7: both October and September's same days start before it.
    const both = computeSnapshot(input({ business_accounts: [CHECKING, CARD] }));
    expect(both.month.current.partial).toBe(true);
    expect(both.month.previous.partial).toBe(true);
    expect(both.month.comparable).toBe(false);
    // Counted from Sep 10: only last month's window is partial.
    const sept = computeSnapshot(input({ business_accounts: [{ ...CHECKING, include_from: "2026-09-10" }] }));
    expect(sept.month.current.partial).toBe(false);
    expect(sept.month.previous.partial).toBe(true);
    expect(sept.month.comparable).toBe(false);
  });

  it("homeSummaryOf gives numbers only, with the oldest update time", () => {
    const now = `${TODAY}T17:00:00Z`;
    const s = computeSnapshot(input({ business_accounts: [CHECKING, CARD] }));
    const h = homeSummaryOf(s);
    expect(h).toMatchObject({ engine_version: "engine-7", today: TODAY, revenue_basis: "completed_jobs", arriving: false });
    // The bank (5 hours ago) is older than Jobber (30 minutes ago).
    expect(h.updated_at).toBe(hoursBefore(now, 5));
    // Partial windows keep their date but never the label naming the account.
    expect(s.month.current.partial_label).toContain("4242");
    expect(h.month?.current).toMatchObject({ partial: true, partial_from: "2026-10-07", partial_label: null });
    expect(h.month?.previous.partial_label).toBeNull();
    expect(JSON.stringify(h)).not.toMatch(/4242|1111|Business Card|Business Checking|Test Bank/);
  });

  it("homeSummaryOf has no update time until every bank and Jobber has one", () => {
    const now = `${TODAY}T17:00:00Z`;
    expect(homeSummaryOf(computeSnapshot(input({ bank_items: [] }))).updated_at).toBeNull();
    expect(homeSummaryOf(computeSnapshot(input({ bank_items: [bank(now, { last_successful_update: null })] }))).updated_at).toBeNull();
    expect(homeSummaryOf(computeSnapshot(input({ jobber: { connected: true, disconnected: false, last_synced_at: null } }))).updated_at).toBeNull();
    // A snapshot from before engine-6 has no month comparison.
    const old = { ...computeSnapshot(input()), month: undefined } as unknown as Snapshot;
    expect(homeSummaryOf(old).month).toBeNull();
  });

  it("arriving is exactly the Pulse screen's stillArriving rule", () => {
    const now = `${TODAY}T17:00:00Z`;
    const fixtures: Array<[string, Snapshot]> = [
      ["normal", computeSnapshot(input())],
      ["no bank", computeSnapshot(input({ bank_items: [] }))],
      ["bank's first update", computeSnapshot(input({ bank_items: [bank(now, { last_successful_update: null })] }))],
      ["bank's past months", computeSnapshot(input({ bank_items: [bank(now, { historical_update_complete: false })] }))],
      ["Jobber importing", computeSnapshot(input({ jobber: { connected: true, disconnected: false, last_synced_at: null } }))],
      ["Jobber disconnected", computeSnapshot(input({ jobber: { connected: true, disconnected: true, last_synced_at: null } }))],
      ["no numbers yet", computeSnapshot(input({}, { L30: { revenue: 0, revenue_count: 0, cost: 0, cost_count: 0, cost_by_category: {} } }))],
    ];
    for (const [name, s] of fixtures) expect(homeSummaryOf(s).arriving, name).toBe(stillArriving(s));
    expect(fixtures.map(([, s]) => homeSummaryOf(s).arriving)).toContain(true);
  });
});

 describe("daily cashflow", () => {
  it("has exactly 30 local dates across the year end", () => {
    const specs = cashflowWindows("2026-01-10");
    expect(specs).toHaveLength(30);
    expect(specs[0]).toEqual({ key: "DAY_2025-12-12", from: "2025-12-12", to: "2025-12-12" });
    expect(specs[29].to).toBe("2026-01-10");
    expect(computeSnapshot(input()).cashflow_30?.points.every(p => p.revenue === null && p.cost === null)).toBe(true);
  });
  it("preserves refunds, rounds cents and shares partial history without account details", () => {
    const base = input({ business_accounts: [CHECKING, CARD] });
    const spec = cashflowWindows(TODAY)[29];
    const s = computeSnapshot({ ...base, daily_windows: {
      [spec.key]: { ...(base.windows.MTD as WindowTotals), from: spec.from, to: spec.to, revenue: -150.125, cost: -20.125 },
    } });
    expect(s.cashflow_30?.points[29]).toEqual({ date: TODAY, revenue: -150.13, cost: -20.13 });
    expect(s.cashflow_30?.partial_from).toBe("2026-10-07");
    expect(homeSummaryOf(s).cashflow_30).toEqual(s.cashflow_30);
    expect(JSON.stringify(homeSummaryOf(s))).not.toMatch(/4242|Business Card/);
  });
});
