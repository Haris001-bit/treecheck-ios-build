// Jobber milestone: TreeCheck's Jobber wrapper. Reads retry only THROTTLED, 429 and 5xx; mutations are
// never resent, and every failure says whether Jobber certainly did not run it (definite) or may have
// (uncertain). Error text stays short and plain and never carries the token. fetch is stubbed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { JOBBER_GRAPHQL_URL, JobberReconnectRequired } from "../../../supabase/functions/_shared/jobber";
import {
  deadline,
  JobberCallError,
  JobberDefiniteError,
  jobberMutate,
  jobberRead,
  JobberUncertainError,
  shortJobberError,
  TC_JOBBER_VERSION,
  throttleOf,
} from "../../../supabase/functions/_shared/jobberApi";

const TOKEN = "test-access-token-0123456789";
const READ = "query TC_Test { account { id name } }";
const MUTATION = "mutation TC_Test { thingCreate { thing { id } userErrors { message path } } }";
const SAVED = { thingCreate: { thing: { id: "T1" }, userErrors: [] } };

type Reply = { status?: number; body?: unknown; raw?: string } | Error | "hang" | "bad-body";

/** Stubs fetch with one reply per call (the last one repeats). "hang" waits until the call is aborted. */
function stubJobber(...replies: Reply[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === "hang") {
      return await new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }
    if (r === "bad-body") {
      return { status: 200, ok: true, text: () => Promise.reject(new TypeError("body stream terminated")) } as unknown as Response;
    }
    if (r instanceof Error) throw r;
    return new Response(r.raw ?? JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const throttledBody = (cost?: unknown) => ({
  errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
  ...(cost ? { extensions: { cost } } : {}),
});

/** Runs a call with fake timers until it settles, and returns what it resolved or threw. */
async function settle<T>(p: Promise<T>, ms = 30_000): Promise<T | Error> {
  const out = p.catch((e: Error) => e);
  await vi.advanceTimersByTimeAsync(ms);
  return out;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the request", () => {
  it("POSTs to Jobber's GraphQL URL with the pinned version and the bearer token", async () => {
    const { calls } = stubJobber({ body: { data: { account: { id: "A1", name: "TC-TEST" } } } });
    const reply = await jobberRead<{ account: { id: string } }>(TOKEN, READ, { first: 5 });
    expect(reply.data.account.id).toBe("A1");
    expect(TC_JOBBER_VERSION).toBe("2026-09-25");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(JOBBER_GRAPHQL_URL);
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-JOBBER-GRAPHQL-VERSION"]).toBe("2026-09-25");
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ query: READ, variables: { first: 5 } });
  });

  it("mutations send the same pinned version", async () => {
    const { calls } = stubJobber({ body: { data: SAVED } });
    await jobberMutate(TOKEN, MUTATION, { input: { title: "TC-TEST" } });
    expect((calls[0].init.headers as Record<string, string>)["X-JOBBER-GRAPHQL-VERSION"]).toBe(TC_JOBBER_VERSION);
  });

  it("returns Jobber's throttle state with the data", async () => {
    const cost = { requestedQueryCost: 52, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 9948, restoreRate: 500 } };
    stubJobber({ body: { data: { account: { id: "A1" } }, extensions: { cost } } });
    const reply = await jobberRead(TOKEN, READ);
    expect(reply.throttle).toEqual({ maximumAvailable: 10000, currentlyAvailable: 9948, restoreRate: 500, requestedQueryCost: 52 });
  });

  it("refuses to call Jobber without a token", async () => {
    const { fetchMock } = stubJobber({ body: { data: {} } });
    const read = await jobberRead("", READ).catch((e) => e);
    expect(read).toBeInstanceOf(JobberCallError);
    expect(read.kind).toBe("no_token");
    expect(read.message).toContain("No Jobber token connected");
    const write = await jobberMutate("", MUTATION).catch((e) => e);
    expect(write).toBeInstanceOf(JobberDefiniteError);
    expect(write.kind).toBe("no_token");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("jobberRead retries", () => {
  it.each([
    ["THROTTLED", { body: throttledBody() }],
    ["HTTP 429", { status: 429, body: {} }],
    ["HTTP 503", { status: 503, raw: "Service Unavailable" }],
  ])("retries after %s, then returns the data", async (_name, first) => {
    vi.useFakeTimers();
    const { calls } = stubJobber(first, { body: { data: { account: { id: "A1" } } } });
    const reply = await settle(jobberRead(TOKEN, READ));
    expect(reply).toEqual({ data: { account: { id: "A1" } }, throttle: null });
    expect(calls).toHaveLength(2);
  });

  it("gives up after the allowed retries and says why", async () => {
    vi.useFakeTimers();
    const throttled = stubJobber({ body: throttledBody() });
    const err = (await settle(jobberRead(TOKEN, READ))) as JobberCallError;
    expect(err).toBeInstanceOf(JobberCallError);
    expect(err.kind).toBe("throttled");
    expect(throttled.calls).toHaveLength(3); // the default: 2 retries

    const down = stubJobber({ status: 502, raw: "Bad Gateway" });
    const err2 = (await settle(jobberRead(TOKEN, READ, {}, { retries: 1 }))) as JobberCallError;
    expect(err2.kind).toBe("http");
    expect(err2.status).toBe(502);
    expect(down.calls).toHaveLength(2);

    const once = stubJobber({ status: 429, body: {} });
    await settle(jobberRead(TOKEN, READ, {}, { retries: 0 }));
    expect(once.calls).toHaveLength(1);
  });

  it("with retryOn \"throttle\", retries THROTTLED and 429 but never a 5xx (the older webhook part's rule)", async () => {
    vi.useFakeTimers();
    const down = stubJobber({ status: 503, raw: "Service Unavailable" }, { body: { data: { ok: 1 } } });
    const err = (await settle(jobberRead(TOKEN, READ, {}, { retries: 1, retryOn: "throttle" }))) as JobberCallError;
    expect(err).toBeInstanceOf(JobberCallError);
    expect(err.kind).toBe("http");
    expect(err.status).toBe(503);
    expect(down.calls).toHaveLength(1);

    for (const first of [{ body: throttledBody() }, { status: 429, body: {} }]) {
      const busy = stubJobber(first, { body: { data: { ok: 2 } } });
      await expect(settle(jobberRead(TOKEN, READ, {}, { retries: 1, retryOn: "throttle" }))).resolves.toMatchObject({ data: { ok: 2 } });
      expect(busy.calls).toHaveLength(2);
    }

    // The default, and "throttle_or_5xx" said outright, retry the 5xx.
    for (const opts of [{ retries: 1 }, { retries: 1, retryOn: "throttle_or_5xx" as const }]) {
      const again = stubJobber({ status: 503, raw: "Service Unavailable" }, { body: { data: { ok: 3 } } });
      await expect(settle(jobberRead(TOKEN, READ, {}, opts))).resolves.toMatchObject({ data: { ok: 3 } });
      expect(again.calls).toHaveLength(2);
    }
  });

  it("waits long enough for Jobber's bucket to refill, but never more than 4 seconds", async () => {
    vi.useFakeTimers();
    // 2,000 points asked, 500 left, 500 restored a second: 3 seconds.
    const cost = { requestedQueryCost: 2000, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 500, restoreRate: 500 } };
    const { calls } = stubJobber({ body: throttledBody(cost) }, { body: { data: { ok: 1 } } });
    const p = jobberRead(TOKEN, READ);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toMatchObject({ data: { ok: 1 } });
    expect(calls).toHaveLength(2);

    const huge = { requestedQueryCost: 10000, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 0, restoreRate: 500 } };
    const second = stubJobber({ body: throttledBody(huge) }, { body: { data: { ok: 2 } } });
    const p2 = jobberRead(TOKEN, READ);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(second.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p2).resolves.toMatchObject({ data: { ok: 2 } });
  });

  it.each([
    ["HTTP 400", { status: 400, body: { errors: [{ message: "Bad request" }] } }, "http"],
    ["HTTP 401", { status: 401, raw: "" }, "http"],
    ["GraphQL errors", { body: { errors: [{ message: "Field 'nope' doesn't exist on type 'Query'" }] } }, "graphql"],
    ["no data", { body: {} }, "no_data"],
    ["a reply that is not JSON", { raw: "<html>oops</html>" }, "bad_reply"],
    ["a network error", new TypeError("fetch failed"), "network"],
  ] as const)("does not retry %s", async (_name, reply, kind) => {
    const { calls } = stubJobber(reply as Reply);
    const err = await jobberRead(TOKEN, READ).catch((e) => e);
    expect(err).toBeInstanceOf(JobberCallError);
    expect(err.kind).toBe(kind);
    expect(calls).toHaveLength(1);
  });

  it("keeps Jobber's own words for refusals and GraphQL errors", async () => {
    stubJobber({ status: 400, body: { errors: [{ message: "Variable $id is required" }] } });
    const refused = await jobberRead(TOKEN, READ).catch((e) => e);
    expect(refused.message).toBe("Jobber refused the request (HTTP 400): Variable $id is required");
    stubJobber({ body: { errors: [{ message: "Quote not found" }, { message: "Second problem" }] } });
    const failed = await jobberRead(TOKEN, READ).catch((e) => e);
    expect(failed.message).toBe("Jobber error: Quote not found; Second problem");
  });

  it("does not return partial data that came with errors", async () => {
    stubJobber({ body: { data: { visits: { nodes: [] } }, errors: [{ message: "Visit 9 failed" }] } });
    const err = await jobberRead(TOKEN, READ).catch((e) => e);
    expect(err.kind).toBe("graphql");
  });

  it("times out one attempt without retrying it", async () => {
    vi.useFakeTimers();
    const { calls } = stubJobber("hang");
    const err = (await settle(jobberRead(TOKEN, READ, {}, { timeoutMs: 8_000 }), 8_000)) as JobberCallError;
    expect(err.kind).toBe("timeout");
    expect(err.message).toBe("Jobber did not answer in time");
    expect(calls).toHaveLength(1);
  });

  it("stops when the caller's budget ends: mid-call, before the call, or while waiting to retry", async () => {
    vi.useFakeTimers();
    const hanging = stubJobber("hang");
    const mid = (await settle(jobberRead(TOKEN, READ, {}, { signal: deadline(2_000) }), 2_000)) as JobberCallError;
    expect(mid.kind).toBe("aborted");
    expect(hanging.calls).toHaveLength(1);

    const ended = new AbortController();
    ended.abort();
    const before = stubJobber({ body: { data: {} } });
    const early = await jobberRead(TOKEN, READ, {}, { signal: ended.signal }).catch((e) => e);
    expect(early.kind).toBe("aborted");
    expect(before.fetchMock).not.toHaveBeenCalled();

    const busy = stubJobber({ body: throttledBody() });
    const waiting = (await settle(jobberRead(TOKEN, READ, {}, { signal: deadline(200) }), 200)) as JobberCallError;
    expect(waiting.kind).toBe("aborted");
    expect(busy.calls).toHaveLength(1);
  });
});

describe("jobberMutate never resends, and says whether Jobber ran it", () => {
  it("returns the data when Jobber saved it", async () => {
    const { calls } = stubJobber({ body: { data: SAVED } });
    const reply = await jobberMutate<typeof SAVED>(TOKEN, MUTATION);
    expect(reply.data.thingCreate.thing.id).toBe("T1");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["HTTP 429", { status: 429, body: {} }, "throttled"],
    ["THROTTLED", { body: throttledBody() }, "throttled"],
    ["THROTTLED even with data", { body: { data: { thingCreate: null }, ...throttledBody() } }, "throttled"],
    ["HTTP 400", { status: 400, body: { errors: [{ message: "Parse error on \"}\"" }] } }, "http"],
    ["HTTP 401", { status: 401, raw: "Unauthorized" }, "http"],
    ["a 4xx reply that is not JSON", { status: 403, raw: "<html>Forbidden</html>" }, "http"],
    ["a validation error with no data", { body: { errors: [{ message: "Argument 'input' is required" }] } }, "graphql"],
    // Jobber's GraphQL server (graphql-ruby) gives a validation error a path into the document, starting with the operation.
    [
      "a validation error with a path into the document",
      { body: { errors: [{ message: "Field 'nope' doesn't exist on type 'ThingCreatePayload'", path: ["mutation TC_Test", "thingCreate", "nope"], extensions: { code: "undefinedField" } }] } },
      "graphql",
    ],
    ["a validation error in an unnamed mutation", { body: { errors: [{ message: "Variable $id is never used", path: ["mutation"] }] } }, "graphql"],
    ["no data at all", { body: {} }, "no_data"],
    ["data null and no errors", { body: { data: null } }, "no_data"],
    ["an empty payload and no errors", { body: { data: { thingCreate: null } } }, "no_data"],
  ] as const)("%s is definite: Jobber did not run it", async (_name, reply, kind) => {
    const { calls } = stubJobber(reply as Reply, { body: { data: SAVED } });
    const err = await jobberMutate(TOKEN, MUTATION).catch((e) => e);
    expect(err).toBeInstanceOf(JobberDefiniteError);
    expect(err).toBeInstanceOf(JobberCallError);
    expect(err.kind).toBe(kind);
    expect(calls).toHaveLength(1);
  });

  it("userErrors on the payload are definite and listed", async () => {
    stubJobber({
      body: { data: { thingCreate: { thing: null, userErrors: [{ message: "Street can't be blank", path: ["street1"] }, { message: "Title is too long", path: ["title"] }] } } },
    });
    const err = await jobberMutate(TOKEN, MUTATION).catch((e) => e);
    expect(err).toBeInstanceOf(JobberDefiniteError);
    expect(err.kind).toBe("user_errors");
    expect(err.userErrors).toEqual(["Street can't be blank", "Title is too long"]);
    expect(err.message).toBe("Jobber did not accept it: Street can't be blank; Title is too long");
  });

  it.each([
    ["HTTP 500", { status: 500, raw: "Internal Server Error" }, "http"],
    ["HTTP 503 with a JSON body", { status: 503, body: { errors: [{ message: "Down for maintenance" }] } }, "http"],
    ["errors that came with data", { body: { data: { thingCreate: { thing: { id: "T1" }, userErrors: [] } }, errors: [{ message: "Internal error" }] } }, "graphql"],
    ["errors that came with an empty payload", { body: { data: { thingCreate: null }, errors: [{ message: "Internal error" }] } }, "graphql"],
    // "data": null means the run had started (GraphQL spec 7.1.2): a non-null payload field failed after Jobber began.
    ["errors with data null", { body: { data: null, errors: [{ message: "Internal error", path: ["thingCreate"] }] } }, "graphql"],
    ["errors with data null and no path", { body: { data: null, errors: [{ message: "Internal error" }] } }, "graphql"],
    ["errors at a result field with no data key", { body: { errors: [{ message: "Internal error", path: ["thingCreate", "thing"] }] } }, "graphql"],
    ["a 2xx reply that is not JSON", { raw: "<html>proxy page</html>" }, "bad_reply"],
    ["a network error", new TypeError("fetch failed"), "network"],
    ["a reply that broke off while reading it", "bad-body", "network"],
  ] as const)("%s is uncertain: Jobber may have run it", async (_name, reply, kind) => {
    const { calls } = stubJobber(reply as Reply, { body: { data: SAVED } });
    const err = await jobberMutate(TOKEN, MUTATION).catch((e) => e);
    expect(err).toBeInstanceOf(JobberUncertainError);
    expect(err).not.toBeInstanceOf(JobberDefiniteError);
    expect(err.kind).toBe(kind);
    expect(err.message).toMatch(/so it may have saved this$/);
    expect(calls).toHaveLength(1);
  });

  it("a timeout after sending is uncertain and is not resent", async () => {
    vi.useFakeTimers();
    const { calls } = stubJobber("hang", { body: { data: SAVED } });
    const err = (await settle(jobberMutate(TOKEN, MUTATION, {}, { timeoutMs: 10_000 }), 10_000)) as JobberUncertainError;
    expect(err).toBeInstanceOf(JobberUncertainError);
    expect(err.kind).toBe("timeout");
    expect(err.message).toBe("Jobber did not answer in time, so it may have saved this");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it("an abort after sending is uncertain; a budget that ended before sending is definite", async () => {
    vi.useFakeTimers();
    const sent = stubJobber("hang");
    const mid = (await settle(jobberMutate(TOKEN, MUTATION, {}, { signal: deadline(1_000) }), 1_000)) as JobberUncertainError;
    expect(mid).toBeInstanceOf(JobberUncertainError);
    expect(mid.kind).toBe("aborted");
    expect(sent.calls).toHaveLength(1);

    const ended = new AbortController();
    ended.abort();
    const unsent = stubJobber({ body: { data: SAVED } });
    const before = await jobberMutate(TOKEN, MUTATION, {}, { signal: ended.signal }).catch((e) => e);
    expect(before).toBeInstanceOf(JobberDefiniteError);
    expect(before.kind).toBe("aborted");
    expect(unsent.fetchMock).not.toHaveBeenCalled();
  });

  it("variables that cannot be sent never count as uncertain", async () => {
    const { fetchMock } = stubJobber({ body: { data: SAVED } });
    const err = await jobberMutate(TOKEN, MUTATION, { amount: 10n }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(JobberUncertainError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the version warning", () => {
  it("is logged once per isolate", async () => {
    vi.resetModules();
    const fresh = await import("../../../supabase/functions/_shared/jobberApi");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubJobber({
      body: { data: { thingCreate: { thing: { id: "T1" } } }, extensions: { versioning: { version: "2026-09-25", warning: "Version 2026-09-25 is ending" } } },
    });
    await fresh.jobberRead(TOKEN, READ);
    await fresh.jobberRead(TOKEN, READ);
    await fresh.jobberMutate(TOKEN, MUTATION);
    const logged = warn.mock.calls.map((c) => String(c[0])).filter((t) => t.includes("version"));
    expect(logged).toEqual(["[jobberApi] Jobber API version 2026-09-25 warning: Version 2026-09-25 is ending"]);
  });

  it("is not logged when Jobber sends none", async () => {
    vi.resetModules();
    const fresh = await import("../../../supabase/functions/_shared/jobberApi");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubJobber({ body: { data: { a: 1 }, extensions: { versioning: { version: "2026-09-25" } } } });
    await fresh.jobberRead(TOKEN, READ);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the token never appears in error text", () => {
  const echo = `token ${TOKEN} was rejected`;
  const read = () => jobberRead(TOKEN, READ, {}, { retries: 0 });
  const write = () => jobberMutate(TOKEN, MUTATION);
  it.each([
    ["a network error that names the token", new TypeError(`request failed with Authorization: Bearer ${TOKEN}`), [read, write]],
    ["GraphQL errors that repeat it", { body: { errors: [{ message: echo }] } }, [read, write]],
    ["a refusal that repeats it", { status: 401, body: { errors: [{ message: echo }] } }, [read, write]],
    ["errors with data that repeat it", { body: { data: { thingCreate: null }, errors: [{ message: echo }] } }, [read, write]],
    ["userErrors that repeat it", { body: { data: { thingCreate: { thing: null, userErrors: [{ message: echo }] } } } }, [write]],
  ] as const)("%s", async (_name, reply, calls) => {
    for (const call of calls) {
      stubJobber(reply as Reply);
      const err = await call().catch((e) => e);
      expect(err).toBeInstanceOf(JobberCallError);
      expect(err.message).not.toContain(TOKEN);
      expect(String(err)).not.toContain(TOKEN);
      expect(shortJobberError(err)).not.toContain(TOKEN);
    }
  });
});

describe("shortJobberError", () => {
  it("keeps a short message as it is", () => {
    expect(shortJobberError(new JobberCallError("timeout", "Jobber did not answer in time"))).toBe("Jobber did not answer in time");
    expect(shortJobberError("plain text")).toBe("plain text");
  });

  it("is at most 200 characters", () => {
    const out = shortJobberError(new Error("x".repeat(1000)));
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("...")).toBe(true);
  });

  it.each([
    ["not found in Jobber", "quote Q1 not found in Jobber"],
    ["No Jobber token connected", "No Jobber token connected"],
    ["reconnect", new JobberReconnectRequired().message],
  ])("keeps the %s marker even when it falls past the cut", (marker, tail) => {
    const out = shortJobberError(new Error(`${"detail ".repeat(60)}${tail}`));
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.toLowerCase()).toContain(marker.toLowerCase());
  });

  it("keeps every marker at once within 200 characters", () => {
    const out = shortJobberError(new Error(`${"y".repeat(400)} not found in Jobber, No Jobber token connected, please reconnect`));
    expect(out.length).toBeLessThanOrEqual(200);
    for (const m of ["not found in Jobber", "No Jobber token connected", "reconnect"]) expect(out).toContain(m);
  });

  it("never contains \"pulse: \"", () => {
    expect(shortJobberError(new Error("pulse: sync failed; Pulse: again"))).not.toMatch(/pulse:/i);
    expect(shortJobberError(new Error(`${"z".repeat(300)} pulse: late`))).not.toMatch(/pulse:/i);
  });

  it("uses plain words: no em or en dashes, one line", () => {
    expect(shortJobberError(new Error("Jobber — down\nfor 2–3 minutes"))).toBe("Jobber, down for 2-3 minutes");
  });

  it("hides anything that looks like a token", () => {
    const out = shortJobberError(new Error("sent Authorization: Bearer abc.DEF-123 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln"));
    expect(out).toBe("sent Authorization: Bearer [hidden] and [hidden]");
  });

  it("describes values that are not errors", () => {
    expect(shortJobberError(null)).toBe("Unknown Jobber error");
    expect(shortJobberError(undefined)).toBe("Unknown Jobber error");
    expect(shortJobberError({ code: 42 })).toBe('{"code":42}');
  });
});

describe("throttleOf", () => {
  it("reads extensions.cost.throttleStatus", () => {
    const ext = { cost: { requestedQueryCost: 10, actualQueryCost: 8, throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 9990, restoreRate: 500 } } };
    expect(throttleOf(ext)).toEqual({ maximumAvailable: 10000, currentlyAvailable: 9990, restoreRate: 500, requestedQueryCost: 10 });
  });

  it("is null when the numbers are missing or malformed", () => {
    expect(throttleOf(undefined)).toBeNull();
    expect(throttleOf(null)).toBeNull();
    expect(throttleOf({})).toBeNull();
    expect(throttleOf({ cost: { throttleStatus: { maximumAvailable: "10000", currentlyAvailable: 1, restoreRate: 500 } } })).toBeNull();
    expect(throttleOf({ cost: { throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 1, restoreRate: 500 } } })).toEqual({
      maximumAvailable: 10000, currentlyAvailable: 1, restoreRate: 500, requestedQueryCost: null,
    });
  });
});

describe("deadline", () => {
  it("ends after the given time, not before", async () => {
    vi.useFakeTimers();
    const signal = deadline(5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe("TimeoutError");
  });
});
