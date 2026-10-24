import { describe, expect, it } from "vitest";
import {
  accountPayload,
  anchorFromSchedule,
  forConnectedJobber,
  furthestStep,
  isNewAccount,
  jobberErrorText,
  nextDraft,
  openingStep,
  parseMoney,
  resumeStep,
  scheduleFromSettings,
  scheduleText,
  serverDraft,
  type PaySchedule,
  type SetupAccount,
  type SetupState,
  upcomingPaydays,
} from "@/components/pulse/setup/setupModel";

const acct = (over: Partial<SetupAccount>): SetupAccount => ({
  id: "a1", item_row_id: "i1", name: "Checking", mask: "7001", type: "depository", subtype: "checking",
  is_business: false, include_from: null, use_for_payroll: false, status: "active", count_from_confirmed_at: null,
  created_at: "2026-10-01T09:00:00Z", ...over,
});

const state = (over: Partial<SetupState> = {}, step: string | null = null): SetupState => ({
  jobberConnected: false,
  jobberAccountName: null,
  banks: [],
  accounts: [],
  settings: {
    pay_frequency: null, pay_anchor_date: null, payroll_amount_override: null, profit_target_monthly: null,
    cash_reserve: null, setup_step: step, setup_completed_at: null, timezone: null,
  },
  ...over,
});

const bank = { id: "i1", institution_name: "Tartan Bank", status: "active", new_accounts_available: false, last_successful_update: null, linked_at: "2026-10-01T00:00:00Z" };

describe("where a returning owner starts", () => {
  it("starts at the beginning the first time", () => {
    expect(resumeStep(state())).toBe("start");
  });
  it("goes back to the saved step", () => {
    expect(resumeStep(state({}, "jobber"))).toBe("jobber");
  });
  it("Jobber is required: without it the owner never gets past the Jobber step", () => {
    expect(furthestStep(state())).toBe("jobber");
    expect(resumeStep(state({}, "banks"))).toBe("jobber");
  });
  it("never goes past linking a bank when none is linked", () => {
    expect(furthestStep(state({ jobberConnected: true }))).toBe("banks");
    expect(resumeStep(state({ jobberConnected: true }, "payroll"))).toBe("banks");
  });
  it("never goes past the accounts step until a business account is saved", () => {
    const s = state({ jobberConnected: true, banks: [bank], accounts: [acct({})] }, "finish");
    expect(resumeStep(s)).toBe("accounts");
    const saved = state({ jobberConnected: true, banks: [bank], accounts: [acct({ is_business: true })] }, "finish");
    expect(resumeStep(saved)).toBe("finish");
  });
  it("ignores an unknown saved step", () => {
    expect(resumeStep(state({}, "done"))).toBe("start");
  });
});

describe("opening the wizard after Jobber's login", () => {
  it("opens on the Jobber step even when the saved step was lost", () => {
    expect(openingStep(state({ jobberConnected: true }, null), "jobber")).toBe("jobber");
    expect(openingStep(state({}, null), "jobber")).toBe("jobber");
  });
  it("never opens past what is done", () => {
    expect(openingStep(state({ jobberConnected: true }, "jobber"), "finish")).toBe("jobber");
  });
  it("without a requested step, resumes", () => {
    expect(openingStep(state({ jobberConnected: true, banks: [bank] }, "banks"))).toBe("banks");
  });
});

describe("payday schedule", () => {
  const today = "2026-10-01";
  const sched = (over: Partial<PaySchedule>): PaySchedule => ({ frequency: null, nextPayday: "", semiPair: null, semiDay: null, monthDay: null, ...over });
  const next3 = (s: PaySchedule) => upcomingPaydays(today, s.frequency, anchorFromSchedule(s, today));

  it("every 2 weeks from the next payday", () => {
    expect(next3(sched({ frequency: "biweekly", nextPayday: "2026-10-09" }))).toEqual(["2026-10-09", "2026-10-23", "2026-11-06"]);
  });
  it("counts today as a payday", () => {
    expect(upcomingPaydays("2026-10-09", "weekly", "2026-10-09")).toEqual(["2026-10-09", "2026-10-16", "2026-10-23"]);
  });
  it("twice a month: the 1st and 15th", () => {
    expect(next3(sched({ frequency: "semimonthly", semiPair: "1-15" }))).toEqual(["2026-10-01", "2026-10-15", "2026-11-01"]);
  });
  it("twice a month: the 15th and the last day", () => {
    expect(next3(sched({ frequency: "semimonthly", semiPair: "15-last" }))).toEqual(["2026-10-15", "2026-10-31", "2026-11-15"]);
  });
  it("twice a month: the 15th and the 30th (February on its last day)", () => {
    expect(next3(sched({ frequency: "semimonthly", semiPair: "15-30" }))).toEqual(["2026-10-15", "2026-10-30", "2026-11-15"]);
    expect(upcomingPaydays("2027-02-16", "semimonthly", anchorFromSchedule(sched({ frequency: "semimonthly", semiPair: "15-30" }), "2027-02-16"), 1)).toEqual(["2027-02-28"]);
  });
  it("twice a month: other days (the 5th and 20th)", () => {
    expect(next3(sched({ frequency: "semimonthly", semiPair: "custom", semiDay: 5 }))).toEqual(["2026-10-05", "2026-10-20", "2026-11-05"]);
  });
  it("once a month on the last day", () => {
    expect(next3(sched({ frequency: "monthly", monthDay: "last" }))).toEqual(["2026-10-31", "2026-11-30", "2026-12-31"]);
  });
  it("once a month on the 30th stays the 30th (and February's last day)", () => {
    expect(next3(sched({ frequency: "monthly", monthDay: 30 }))).toEqual(["2026-10-30", "2026-11-30", "2026-12-30"]);
    expect(upcomingPaydays("2027-02-01", "monthly", anchorFromSchedule(sched({ frequency: "monthly", monthDay: 30 }), "2027-02-01"), 1)).toEqual(["2027-02-28"]);
  });
  it("is empty until the answers are complete", () => {
    expect(anchorFromSchedule(sched({ frequency: "semimonthly" }), today)).toBeNull();
    expect(anchorFromSchedule(sched({ frequency: "monthly" }), today)).toBeNull();
    expect(anchorFromSchedule(sched({ frequency: "weekly" }), today)).toBeNull();
    expect(upcomingPaydays(today, null, "2026-10-09")).toEqual([]);
  });
  it("reading a saved schedule back and saving it again never moves a payday", () => {
    const saved: Array<[PaySchedule["frequency"], string]> = [
      ["semimonthly", "2026-10-15"], ["semimonthly", "2026-10-31"], ["semimonthly", "2026-10-01"], ["semimonthly", "2026-10-20"], ["semimonthly", "2026-01-30"],
      ["monthly", "2026-10-31"], ["monthly", "2026-10-30"], ["monthly", "2026-09-30"], ["monthly", "2026-10-05"],
      ["biweekly", "2026-10-09"], ["weekly", "2026-09-04"],
    ];
    for (const [f, anchor] of saved) {
      const back = anchorFromSchedule(scheduleFromSettings(f, anchor, today), today);
      expect(upcomingPaydays(today, f, back, 4), `${f} ${anchor}`).toEqual(upcomingPaydays(today, f, anchor, 4));
    }
  });
  it("says the schedule in words", () => {
    expect(scheduleText("semimonthly", "2026-01-01")).toBe("on the 1st and 15th");
    expect(scheduleText("semimonthly", "2026-01-15")).toBe("on the 15th and the last day of the month");
    expect(scheduleText("semimonthly", "2026-01-05")).toBe("on the 5th and 20th");
    expect(scheduleText("semimonthly", "2026-01-30")).toBe("on the 15th and 30th");
    expect(scheduleText("monthly", "2026-01-31")).toBe("on the last day of each month");
    expect(scheduleText("monthly", "2026-01-22")).toBe("on the 22nd of each month");
    expect(scheduleText("biweekly", "2026-10-09")).toBe("every 2 weeks");
  });
});

describe("typed amounts", () => {
  it("reads dollars with or without $ and commas", () => {
    expect(parseMoney("1,500")).toBe(1500);
    expect(parseMoney("$2500.50")).toBe(2500.5);
    expect(parseMoney("")).toBeNull();
  });
  it("refuses anything else", () => {
    expect(parseMoney("abc")).toBeNaN();
    expect(parseMoney("-5")).toBeNaN();
    expect(parseMoney("1.234")).toBeNaN();
  });
});

describe("what is saved for each account", () => {
  it("pays payroll only from a business bank account, never a card", () => {
    const card = acct({ id: "c1", type: "credit", subtype: "credit card", is_business: true, use_for_payroll: true });
    const checking = acct({ id: "a1", is_business: true, use_for_payroll: true });
    const personal = acct({ id: "a2", is_business: false, use_for_payroll: true });
    const out = accountPayload([card, checking, personal], (a) => serverDraft(a));
    expect(out.find((x) => x.id === "c1")?.use_for_payroll).toBe(false);
    expect(out.find((x) => x.id === "a1")?.use_for_payroll).toBe(true);
    expect(out.find((x) => x.id === "a2")?.use_for_payroll).toBe(false);
  });
  it("sends the card choice only for a business card", () => {
    const card = acct({ id: "c1", type: "credit", is_business: true, include_from: "2026-10-01", count_from_confirmed_at: "2026-10-01T10:00:00Z" });
    const out = accountPayload([card], (a) => serverDraft(a));
    expect(out[0]).toMatchObject({ is_business: true, include_from: "2026-10-01", count_from_chosen: true });
  });
  it("a card turned back on as business asks its question again", () => {
    const card = acct({ id: "c1", type: "credit", is_business: false, include_from: "2026-09-01", count_from_confirmed_at: "2026-09-01T10:00:00Z" });
    const d = nextDraft(card, serverDraft(card), { is_business: true });
    expect(d).toMatchObject({ is_business: true, count_from_chosen: false, include_from: null });
    const checking = acct({ id: "a1", is_business: false });
    expect(nextDraft(checking, serverDraft(checking), { is_business: true }).is_business).toBe(true);
  });
});

describe("accounts added after setup", () => {
  const done = "2026-10-05T12:00:00Z";
  const now = Date.parse("2026-10-10T12:00:00Z");
  it("are New until the owner turns them on", () => {
    expect(isNewAccount(acct({ created_at: "2026-10-09T08:00:00Z" }), done, now)).toBe(true);
    expect(isNewAccount(acct({ created_at: "2026-10-09T08:00:00Z", is_business: true }), done, now)).toBe(false);
  });
  it("accounts from setup itself, closed ones and any before setup are not New", () => {
    expect(isNewAccount(acct({ created_at: "2026-10-01T08:00:00Z" }), done, now)).toBe(false);
    expect(isNewAccount(acct({ created_at: "2026-10-09T08:00:00Z", status: "closed" }), done, now)).toBe(false);
    expect(isNewAccount(acct({ created_at: "2026-10-09T08:00:00Z" }), null, now)).toBe(false);
  });
  it("an account the owner keeps personal stops being New after two weeks", () => {
    expect(isNewAccount(acct({ created_at: "2026-10-09T08:00:00Z" }), done, Date.parse("2026-10-24T08:00:00Z"))).toBe(false);
  });
  it("compares times, not text (Postgres and JavaScript write timestamps differently)", () => {
    expect(isNewAccount(acct({ created_at: "2026-10-05T12:00:00.5+00:00" }), "2026-10-05T12:00:00.000Z", now)).toBe(true);
    expect(isNewAccount(acct({ created_at: "2026-10-05T11:59:59+00:00" }), "2026-10-05T12:00:00.000Z", now)).toBe(false);
  });
});

describe("Jobber's reply in the address bar", () => {
  it("turns the callback's own sentences into owner wording with a next step", () => {
    expect(jobberErrorText("This connection link expired. Please tap Connect Jobber again.")).toBe("This connection link expired. Please press Connect Jobber again.");
    expect(jobberErrorText("This Jobber account is already connected to another TreeCheck company. Each Jobber account can be connected to one TreeCheck company."))
      .toBe("This Jobber account is already connected to another TreeCheck company. Please contact TreeCheck to move it to this company.");
    expect(jobberErrorText("Jobber did not return an authorization code.")).toBe("Jobber didn't connect. Please press Connect Jobber to try again.");
  });
  it("a link naming a built-in property is just a failed connection", () => {
    expect(jobberErrorText("toString")).toBe("Jobber didn't connect. Please press Connect Jobber to try again.");
    expect(jobberErrorText("constructor")).toBe("Jobber didn't connect. Please press Connect Jobber to try again.");
  });
  it("never shows other text from a link", () => {
    expect(jobberErrorText("Call 555-0100 to verify your bank")).toBe("Jobber didn't connect. Please press Connect Jobber to try again.");
    expect(jobberErrorText("access_denied")).toBe("Jobber wasn't allowed to connect. Press Connect Jobber to try again.");
    expect(jobberErrorText(null)).toBeNull();
  });
  it("an owner still connected is pointed at Reconnect Jobber (their button)", () => {
    expect(forConnectedJobber(jobberErrorText("Jobber did not return an authorization code.") as string))
      .toBe("Jobber didn't connect. Please press Reconnect Jobber to try again.");
    expect(forConnectedJobber(jobberErrorText("access_denied") as string)).toBe("Jobber wasn't allowed to connect. Press Reconnect Jobber to try again.");
    // Already worded for reconnecting: unchanged.
    expect(forConnectedJobber("Please press Reconnect Jobber again.")).toBe("Please press Reconnect Jobber again.");
  });
});
