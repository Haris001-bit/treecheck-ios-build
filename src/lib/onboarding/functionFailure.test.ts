// What a failed edge function call said, so signup screens show the real reason (not "non-2xx status code") and
// only server failures alert anyone.
import { describe, expect, it } from "vitest";
import { functionFailure, isUserFixable } from "@/lib/functionFailure";

class FakeHttpError extends Error {
  constructor(public context: Response) {
    super("Edge Function returned a non-2xx status code");
  }
}

describe("functionFailure", () => {
  it("is null when the call worked", async () => {
    expect(await functionFailure(null, { success: true })).toBeNull();
  });

  it("reads an error the function answered with 200", async () => {
    const f = await functionFailure(null, { error: "This invite link isn't taking new members." });
    expect(f).toEqual({ message: "This invite link isn't taking new members.", status: 200 });
    expect(isUserFixable(f!)).toBe(true);
  });

  it("reads the function's own message from a 400 answer", async () => {
    const res = new Response(JSON.stringify({ error: "Enter that account's password" }), { status: 400 });
    const f = await functionFailure(new FakeHttpError(res), null);
    expect(f).toEqual({ message: "Enter that account's password", status: 400 });
    expect(isUserFixable(f!)).toBe(true);
  });

  it("treats a 500 or no answer at all as something to report", async () => {
    const res = new Response("oops", { status: 500 });
    const server = await functionFailure(new FakeHttpError(res), null);
    expect(server?.status).toBe(500);
    expect(isUserFixable(server!)).toBe(false);
    const offline = await functionFailure(new TypeError("Failed to fetch"), null);
    expect(offline).toEqual({ message: "Failed to fetch", status: null });
    expect(isUserFixable(offline!)).toBe(false);
  });
});
