// Jobber milestone switches (company_jobber_settings, plan 2.4): the kill switch, a missing row, a read
// error and a missing table all mean every switch is off, and the read never throws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobberSwitches, killSwitchOn, SWITCHES_OFF } from "../../../supabase/functions/_shared/jobberSwitches";

/** Just enough of supabase-js for one company_jobber_settings read. */
function fakeAdmin(result: { data?: unknown; error?: unknown } | { throws: Error }) {
  const reads: { table: string; columns: string; column: string; value: string }[] = [];
  const admin = {
    from: vi.fn((table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            reads.push({ table, columns, column, value });
            if ("throws" in result) throw result.throws;
            return { data: result.data ?? null, error: result.error ?? null };
          },
        }),
      }),
    })),
  };
  return { admin, reads };
}

const ALL_ON = {
  quotes_on_award: true,
  auto_hire: true,
  book_jobs: true,
  completion_sync: true,
  free_days: true,
  jobber_import: true,
  closeout_invoices: true,
  busy_visits_per_day: 3,
  timezone: "America/Denver",
  default_province: "OK",
  quote_template: { taxable: false, scope_lines: ["Haul away debris"] },
};

function setEnv(vars: Record<string, string | undefined>) {
  vi.stubGlobal("Deno", { env: { get: (k: string) => vars[k] } });
}

beforeEach(() => {
  setEnv({});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SWITCHES_OFF", () => {
  it("has every switch off and the default settings, and cannot be changed", () => {
    expect(SWITCHES_OFF).toEqual({
      quotesOnAward: false,
      autoHire: false,
      bookJobs: false,
      completionSync: false,
      freeDays: false,
      jobberImport: false,
      closeoutInvoices: false,
      busyVisitsPerDay: 1,
      timezone: "America/Chicago",
      defaultProvince: null,
      quoteTemplate: {},
    });
    expect(Object.isFrozen(SWITCHES_OFF)).toBe(true);
    expect(Object.isFrozen(SWITCHES_OFF.quoteTemplate)).toBe(true);
  });
});

describe("killSwitchOn", () => {
  it.each([
    ["1", true],
    [" 1\n", true],
    ["0", false],
    ["", false],
    ["true", false],
    [undefined, false],
  ])("TC_JOBBER_KILL=%j is %s", (value, on) => {
    setEnv({ TC_JOBBER_KILL: value });
    expect(killSwitchOn()).toBe(on);
  });

  it("is off when there is no Deno environment (vitest, the browser)", () => {
    vi.unstubAllGlobals();
    expect(killSwitchOn()).toBe(false);
  });
});

describe("jobberSwitches", () => {
  it("reads the owner's row and maps it to camelCase", async () => {
    const { admin, reads } = fakeAdmin({ data: ALL_ON });
    expect(await jobberSwitches(admin, "owner-1")).toEqual({
      quotesOnAward: true,
      autoHire: true,
      bookJobs: true,
      completionSync: true,
      freeDays: true,
      jobberImport: true,
      closeoutInvoices: true,
      busyVisitsPerDay: 3,
      timezone: "America/Denver",
      defaultProvince: "OK",
      quoteTemplate: { taxable: false, scope_lines: ["Haul away debris"] },
    });
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ table: "company_jobber_settings", column: "contractor_id", value: "owner-1" });
    for (const col of Object.keys(ALL_ON)) expect(reads[0].columns).toContain(col);
  });

  it("kill switch on: all off, and the database is never read", async () => {
    setEnv({ TC_JOBBER_KILL: "1" });
    const { admin } = fakeAdmin({ data: ALL_ON });
    expect(await jobberSwitches(admin, "owner-1")).toEqual(SWITCHES_OFF);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("no row for the company: all off", async () => {
    const { admin } = fakeAdmin({ data: null });
    expect(await jobberSwitches(admin, "owner-1")).toEqual(SWITCHES_OFF);
  });

  it("a read error: all off, with a warning", async () => {
    const { admin } = fakeAdmin({ error: { message: "connection reset" } });
    expect(await jobberSwitches(admin, "owner-1")).toEqual(SWITCHES_OFF);
    expect(console.warn).toHaveBeenCalled();
  });

  it.each([
    ["Postgres", { code: "42P01", message: 'relation "public.company_jobber_settings" does not exist' }],
    ["PostgREST", { code: "PGRST205", message: "Could not find the table 'public.company_jobber_settings' in the schema cache" }],
  ])("the table does not exist yet (%s): all off", async (_name, error) => {
    const { admin } = fakeAdmin({ error });
    expect(await jobberSwitches(admin, "owner-1")).toEqual(SWITCHES_OFF);
  });

  it("never throws, even when the client does", async () => {
    const { admin } = fakeAdmin({ throws: new TypeError("fetch failed") });
    await expect(jobberSwitches(admin, "owner-1")).resolves.toEqual(SWITCHES_OFF);
  });

  it("no owner id: all off without a read", async () => {
    const { admin } = fakeAdmin({ data: ALL_ON });
    expect(await jobberSwitches(admin, "")).toEqual(SWITCHES_OFF);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("only a real true turns a switch on", async () => {
    const { admin } = fakeAdmin({ data: { ...ALL_ON, quotes_on_award: "true", auto_hire: 1, book_jobs: null } });
    const s = await jobberSwitches(admin, "owner-1");
    expect([s.quotesOnAward, s.autoHire, s.bookJobs, s.completionSync]).toEqual([false, false, false, true]);
  });

  it.each([
    [0, 1],
    [25, 20],
    ["4", 4],
    [2.7, 2],
    [null, 1],
    ["many", 1],
  ])("busy_visits_per_day %j reads as %i", async (stored, expected) => {
    const { admin } = fakeAdmin({ data: { ...ALL_ON, busy_visits_per_day: stored } });
    expect((await jobberSwitches(admin, "owner-1")).busyVisitsPerDay).toBe(expected);
  });

  it("an unknown time zone falls back to America/Chicago, so date code never throws", async () => {
    const odd = await jobberSwitches(fakeAdmin({ data: { ...ALL_ON, timezone: "Mars/Olympus_Mons" } }).admin, "owner-1");
    expect(odd.timezone).toBe("America/Chicago");
    const blank = await jobberSwitches(fakeAdmin({ data: { ...ALL_ON, timezone: "" } }).admin, "owner-1");
    expect(blank.timezone).toBe("America/Chicago");
    const padded = await jobberSwitches(fakeAdmin({ data: { ...ALL_ON, timezone: " America/New_York " } }).admin, "owner-1");
    expect(padded.timezone).toBe("America/New_York");
  });

  it("keeps only a two-letter capital state and an object template", async () => {
    const s = await jobberSwitches(fakeAdmin({ data: { ...ALL_ON, default_province: "ok", quote_template: ["x"] } }).admin, "owner-1");
    expect(s.defaultProvince).toBeNull();
    expect(s.quoteTemplate).toEqual({});
    const t = await jobberSwitches(fakeAdmin({ data: { ...ALL_ON, default_province: "OKL", quote_template: null } }).admin, "owner-1");
    expect(t.defaultProvince).toBeNull();
    expect(t.quoteTemplate).toEqual({});
  });
});
