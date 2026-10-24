// Jobber milestone, the token rule (plan 2.5): tokenFor (getJobberToken) always runs to completion
// before any time budget starts, budgets are only AbortSignals on Jobber fetches, and nothing races
// the token. A budget that runs out after a mutation was sent leaves it uncertain, never failed.
// getJobberToken is replaced by a slow fake; fetch is stubbed; timers are fake.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJobberToken, JobberReconnectRequired } from "../../../supabase/functions/_shared/jobber";
import {
  deadline,
  JobberCallError,
  JobberDefiniteError,
  jobberMutate,
  jobberRead,
  JobberUncertainError,
  tokenFor,
} from "../../../supabase/functions/_shared/jobberApi";

vi.mock("../../../supabase/functions/_shared/jobber", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../supabase/functions/_shared/jobber")>();
  return { ...real, getJobberToken: vi.fn() };
});

const admin = { name: "fake admin" };
const MUTATION = "mutation TC_Test { thingCreate { thing { id } userErrors { message path } } }";
const SAVED = { thingCreate: { thing: { id: "T1" }, userErrors: [] } };

/** A sign-in refresh that takes `ms` and saves the rotated token before returning it. */
function slowToken(ms: number) {
  const steps: string[] = [];
  vi.mocked(getJobberToken).mockImplementation(async (_admin, ownerId) => {
    steps.push(`refresh started for ${ownerId}`);
    await new Promise((r) => setTimeout(r, ms));
    steps.push("rotated token saved");
    return "fresh-token-0123456789";
  });
  return steps;
}

/** Jobber answers after `ms`, unless the call is aborted first. "hang" never answers. */
function jobberAnswersAfter(ms: number | "hang", body: unknown = { data: SAVED }) {
  const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = ms === "hang" ? null : setTimeout(() => resolve(new Response(JSON.stringify(body))), ms);
    init.signal?.addEventListener("abort", () => {
      if (timer) clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getJobberToken).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tokenFor", () => {
  it("waits for a slow sign-in refresh in full: it has no time limit of its own", async () => {
    const steps = slowToken(90_000);
    let done = false;
    const p = tokenFor(admin, "owner-1").then((t) => {
      done = true;
      return t;
    });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe("fresh-token-0123456789");
    expect(steps).toEqual(["refresh started for owner-1", "rotated token saved"]);
    expect(getJobberToken).toHaveBeenCalledWith(admin, "owner-1");
  });

  it("passes a refusal on unchanged, so the caller sees the reconnect", async () => {
    const refused = new JobberReconnectRequired();
    vi.mocked(getJobberToken).mockRejectedValue(refused);
    await expect(tokenFor(admin, "owner-1")).rejects.toBe(refused);
  });

  it("takes only the admin client and the owner id: no signal or time limit can reach the refresh", () => {
    expect(tokenFor.length).toBe(2);
  });
});

describe("the budget starts after the token", () => {
  it("a slow refresh does not use up the budget of the Jobber call after it", async () => {
    const steps = slowToken(5_000);
    const fetchMock = jobberAnswersAfter(1_500);
    const run = (async () => {
      const token = await tokenFor(admin, "owner-1");
      return jobberMutate(token, MUTATION, {}, { signal: deadline(2_000) });
    })();
    await vi.advanceTimersByTimeAsync(6_500);
    await expect(run).resolves.toEqual({ data: SAVED, throttle: null });
    expect(steps).toEqual(["refresh started for owner-1", "rotated token saved"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a budget started before the token would have run out before anything was sent", async () => {
    slowToken(5_000);
    const fetchMock = jobberAnswersAfter(1_500);
    const run = (async () => {
      const signal = deadline(2_000); // the wrong order, for contrast
      const token = await tokenFor(admin, "owner-1");
      return jobberMutate(token, MUTATION, {}, { signal });
    })().catch((e) => e);
    await vi.advanceTimersByTimeAsync(6_500);
    const err = await run;
    expect(err).toBeInstanceOf(JobberDefiniteError);
    expect(err.kind).toBe("aborted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the refresh is never cut short, even when the budget is tiny", async () => {
    const steps = slowToken(30_000);
    jobberAnswersAfter(10);
    const run = (async () => {
      const token = await tokenFor(admin, "owner-1");
      return jobberRead(token, "query TC_Test { account { id } }", {}, { signal: deadline(50) });
    })();
    await vi.advanceTimersByTimeAsync(30_100);
    await expect(run).resolves.toEqual({ data: SAVED, throttle: null });
    expect(steps).toEqual(["refresh started for owner-1", "rotated token saved"]);
  });
});

describe("when the budget runs out", () => {
  it("after a mutation was sent, the step is uncertain and the mutation is not resent", async () => {
    slowToken(0);
    const fetchMock = jobberAnswersAfter("hang");
    const run = (async () => {
      const token = await tokenFor(admin, "owner-1");
      // A budget shorter than the 15-second default time limit of one mutation.
      return jobberMutate(token, MUTATION, {}, { signal: deadline(10_000) });
    })().catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await run;
    expect(err).toBeInstanceOf(JobberUncertainError);
    expect(err.kind).toBe("aborted");
    expect(err.message).toBe("Time ran out before Jobber answered, so it may have saved this");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a read stops retrying and says time ran out", async () => {
    slowToken(0);
    const throttled = { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] };
    const fetchMock = jobberAnswersAfter(100, throttled);
    const run = (async () => {
      const token = await tokenFor(admin, "owner-1");
      return jobberRead(token, "query TC_Test { account { id } }", {}, { signal: deadline(300), retries: 5 });
    })().catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    const err = await run;
    expect(err).toBeInstanceOf(JobberCallError);
    expect(err.kind).toBe("aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("nothing races the token", () => {
  const source = readFileSync(join(process.cwd(), "supabase/functions/_shared/jobberApi.ts"), "utf8");
  // The code without its comments (the header explains the rule in words).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("jobberApi.ts never uses Promise.race", () => {
    expect(code).toContain("getJobberToken(admin, ownerId)");
    expect(code).not.toMatch(/Promise\s*\.\s*race/);
  });

  it("tokenFor only awaits getJobberToken", () => {
    expect(source).toMatch(
      /export async function tokenFor\(admin: Admin, ownerId: string\): Promise<string \| null> \{\s*return await getJobberToken\(admin, ownerId\);\s*\}/,
    );
  });
});
