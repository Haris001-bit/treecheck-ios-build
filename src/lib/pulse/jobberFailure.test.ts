// Financial Pulse: a failing Jobber import is counted (tries in a row) in jobber_sync_state.last_error,
// so the Pulse screen says there's a problem after three failed tries, or at once when Jobber refused
// the stored sign-in, instead of waiting for a while.
import { describe, expect, it } from "vitest";
import {
  FAILING_AFTER,
  failureCount,
  failureText,
  importFailing,
  needsReconnect,
  RECONNECT_ERROR,
} from "../../../supabase/functions/_shared/pulse/jobberFailure";

describe("failureCount", () => {
  it("is 0 when nothing failed", () => {
    expect(failureCount(null)).toBe(0);
    expect(failureCount(undefined)).toBe(0);
    expect(failureCount({})).toBe(0);
    expect(failureCount({ last_error: null })).toBe(0);
    expect(failureCount({ last_error: "" })).toBe(0);
  });

  it("reads the count, with or without the reconnect mark", () => {
    expect(failureCount({ last_error: "#2 Jobber timed out" })).toBe(2);
    expect(failureCount({ last_error: "reconnect: #5 refresh token rejected" })).toBe(5);
  });

  it("counts an error saved before counting existed as one try", () => {
    expect(failureCount({ last_error: "Jobber timed out" })).toBe(1);
    expect(failureCount({ last_error: "reconnect: refresh token rejected" })).toBe(1);
  });

  it("ignores anything that isn't text", () => {
    expect(failureCount({ last_error: 3 })).toBe(0);
  });
});

describe("failureText", () => {
  it("counts on from the previous try", () => {
    const first = failureText(null, false, "Jobber timed out");
    expect(first).toBe("#1 Jobber timed out");
    const second = failureText({ last_error: first }, false, "Jobber timed out");
    expect(second).toBe("#2 Jobber timed out");
    expect(failureCount({ last_error: second })).toBe(2);
  });

  it("marks a refused sign-in and keeps counting", () => {
    const t = failureText({ last_error: "#2 Jobber timed out" }, true, "refresh token rejected");
    expect(t).toBe(`${RECONNECT_ERROR} #3 refresh token rejected`);
    expect(needsReconnect({ last_error: t })).toBe(true);
    expect(failureCount({ last_error: t })).toBe(3);
  });

  it("starts again at 1 after a try that worked (last_error cleared)", () => {
    expect(failureText({ last_error: null }, false, "x")).toBe("#1 x");
  });

  it("stays within the column's 500 characters", () => {
    expect(failureText(null, true, "e".repeat(800))).toHaveLength(500);
  });
});

describe("importFailing", () => {
  it("is false for nothing, and for fewer failed tries in a row than the limit", () => {
    expect(importFailing(null)).toBe(false);
    let state: { last_error: string | null } = { last_error: null };
    for (let i = 1; i < FAILING_AFTER; i++) {
      state = { last_error: failureText(state, false, "Jobber timed out") };
      expect(importFailing(state)).toBe(false);
    }
  });

  it(`is true after ${FAILING_AFTER} failed tries in a row`, () => {
    let state: { last_error: string | null } = { last_error: null };
    for (let i = 0; i < FAILING_AFTER; i++) state = { last_error: failureText(state, false, "Jobber timed out") };
    expect(importFailing(state)).toBe(true);
  });

  it("is true at once when Jobber refused the sign-in", () => {
    expect(importFailing({ last_error: failureText(null, true, "refresh token rejected") })).toBe(true);
  });

  it("is false again once a try worked", () => {
    expect(importFailing({ last_error: null })).toBe(false);
  });
});
