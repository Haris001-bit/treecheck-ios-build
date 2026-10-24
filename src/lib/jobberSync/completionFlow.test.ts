// Jobber milestone: a job closed in Jobber marks its TreeCheck job complete (jobberCompletion.ts).
// Jobber is stubbed; the database is a small fake.
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeFromJobber } from "../../../supabase/functions/_shared/jobberCompletion";
import { SWITCHES_OFF, type JobberSwitches } from "../../../supabase/functions/_shared/jobberSwitches";

const ON: JobberSwitches = { ...SWITCHES_OFF, completionSync: true };
const deps = (switches: JobberSwitches = ON, token: string | null = "tok") => ({
  switches: async () => switches,
  token: async () => token,
});

function stubJob(job: unknown, status = 200) {
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)).variables);
    return new Response(JSON.stringify(status === 200 ? { data: { job } } : {}), { status });
  }));
  return calls;
}

/** Just enough of supabase-js: the request lookup, the conditional status update and the activity insert. */
function fakeAdmin(request: Record<string, unknown> | null, updatedRows: unknown[] = [{ id: "R1" }]) {
  const seen = { lookup: [] as unknown[][], update: null as Record<string, unknown> | null, inStatuses: [] as string[], activity: [] as unknown[] };
  const admin = {
    from: (table: string) => {
      if (table === "job_activity") return { insert: async (row: unknown) => { seen.activity.push(row); return { error: null }; } };
      return {
        select: () => {
          const chain = {
            eq: (column: string, value: unknown) => {
              seen.lookup.push([column, value]);
              return chain;
            },
            maybeSingle: async () => ({ data: request }),
          };
          return chain;
        },
        update: (values: Record<string, unknown>) => {
          seen.update = values;
          const chain = {
            eq: () => chain,
            in: (_column: string, statuses: string[]) => {
              seen.inStatuses = statuses;
              return chain;
            },
            select: async () => ({ data: updatedRows, error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { admin, seen };
}

const closedJob = (over: Record<string, unknown> = {}) => ({
  id: "J1",
  jobNumber: 12,
  jobStatus: "requires_invoicing",
  completedAt: "2026-10-15T22:00:00Z",
  quote: { id: "Q1" },
  visitsInfo: { incompleteTotal: 0 },
  visits: { nodes: [{ id: "V1", isComplete: true }] },
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("completeFromJobber", () => {
  it("does nothing while the company's switch is off", async () => {
    const calls = stubJob(closedJob());
    const { admin, seen } = fakeAdmin({ id: "R1", workflow_status: "job_scheduled" });
    expect(await completeFromJobber(admin, "OWNER", "J1", deps(SWITCHES_OFF))).toBeNull();
    expect(calls).toHaveLength(0);
    expect(seen.update).toBeNull();
  });

  it("records a missing connection without calling Jobber", async () => {
    const calls = stubJob(closedJob());
    const { admin } = fakeAdmin(null);
    expect(await completeFromJobber(admin, "OWNER", "J1", deps(ON, null))).toBe("tc: no Jobber token");
    expect(calls).toHaveLength(0);
  });

  it("leaves jobs that didn't come from a TreeCheck quote alone", async () => {
    stubJob(closedJob({ quote: null }));
    const none = fakeAdmin({ id: "R1", workflow_status: "job_scheduled" });
    expect(await completeFromJobber(none.admin, "OWNER", "J1", deps())).toBe("tc: not a TreeCheck job");
    expect(none.seen.update).toBeNull();

    stubJob(closedJob());
    const other = fakeAdmin(null);
    expect(await completeFromJobber(other.admin, "OWNER", "J1", deps())).toBe("tc: not a TreeCheck job");
    expect(other.seen.lookup).toEqual([["jobber_quote_id", "Q1"], ["owner_contractor_id", "OWNER"]]);
  });

  it("marks the job complete once, only from an open status, and notes it on the job", async () => {
    const calls = stubJob(closedJob());
    const { admin, seen } = fakeAdmin({ id: "R1", workflow_status: "job_scheduled" });
    expect(await completeFromJobber(admin, "OWNER", "J1", deps())).toBe("tc: marked complete from Jobber job #12");
    expect(calls).toEqual([{ id: "J1" }]);
    expect(seen.update).toEqual({ workflow_status: "job_complete" });
    expect(seen.inStatuses).toEqual(["open", "assessment_scheduled", "quote_sent", "quote_accepted", "job_scheduled"]);
    expect(seen.activity).toEqual([{
      bid_request_id: "R1",
      kind: "jobber_completed",
      summary: "Marked complete from Jobber (job #12)",
      actor_user_id: null,
    }]);
  });

  it("leaves a job closed with no visit done as it is", async () => {
    stubJob(closedJob({ visits: { nodes: [{ id: "V1", isComplete: false }] }, visitsInfo: { incompleteTotal: 0 } }));
    const { admin, seen } = fakeAdmin({ id: "R1", workflow_status: "job_scheduled" });
    expect(await completeFromJobber(admin, "OWNER", "J1", deps())).toBe("tc: closed in Jobber with no visit done, so left as is");
    expect(seen.update).toBeNull();
  });

  it("waits while Jobber still has the job open", async () => {
    stubJob(closedJob({ completedAt: null, jobStatus: "active", visitsInfo: { incompleteTotal: 1 } }));
    const { admin, seen } = fakeAdmin({ id: "R1", workflow_status: "job_scheduled" });
    expect(await completeFromJobber(admin, "OWNER", "J1", deps())).toBe("tc: not complete yet");
    expect(seen.update).toBeNull();
  });

  it("never overwrites a status the office set meanwhile", async () => {
    stubJob(closedJob());
    const done = fakeAdmin({ id: "R1", workflow_status: "no_longer_needed" });
    expect(await completeFromJobber(done.admin, "OWNER", "J1", deps())).toBe("tc: already closed in TreeCheck, so left as is");
    expect(done.seen.update).toBeNull();

    const raced = fakeAdmin({ id: "R1", workflow_status: "job_scheduled" }, []);
    expect(await completeFromJobber(raced.admin, "OWNER", "J1", deps())).toBe("tc: status changed meanwhile, so left as is");
    expect(raced.seen.activity).toEqual([]);
  });

  it("throws on a Jobber error, so the webhook retries it", async () => {
    stubJob(null, 502);
    const { admin } = fakeAdmin({ id: "R1", workflow_status: "job_scheduled" });
    await expect(completeFromJobber(admin, "OWNER", "J1", deps())).rejects.toThrow(/server error/i);
  });
});
