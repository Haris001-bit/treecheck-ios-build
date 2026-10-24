// Financial Pulse: "Jobber ... ago" follows the newest news from Jobber, so a job a webhook saved a
// minute ago shows as a minute ago, not the time of the last full check for changes.
import { describe, expect, it } from "vitest";
import { jobberUpdatedAt, WATERMARK_OVERLAP_MS } from "../../../supabase/functions/_shared/pulse/jobberFreshness";

const at = (iso: string) => new Date(iso).toISOString();
const minus = (iso: string, ms: number) => new Date(Date.parse(iso) - ms).toISOString();

describe("jobberUpdatedAt", () => {
  it("is null while the first import has not finished", () => {
    expect(jobberUpdatedAt(null, null)).toBeNull();
    expect(jobberUpdatedAt(undefined, undefined)).toBeNull();
    expect(jobberUpdatedAt({}, null)).toBeNull();
    // Pages of the first import are being saved: still null, the past jobs are not all in.
    expect(jobberUpdatedAt({ incremental_watermark: null, backfill_completed_at: null }, at("2026-10-05T15:00:00Z"))).toBeNull();
  });

  it("is the start of the last check for changes (the overlap added back)", () => {
    const start = "2026-10-05T15:00:00Z";
    const state = { incremental_watermark: minus(start, WATERMARK_OVERLAP_MS), backfill_completed_at: at("2026-10-05T14:00:00Z") };
    expect(jobberUpdatedAt(state, null)).toBe(at(start));
    // Saves older than the check don't pull it back.
    expect(jobberUpdatedAt(state, at("2026-10-05T14:30:00Z"))).toBe(at(start));
  });

  it("moves to a job a webhook saved after the last check", () => {
    const state = { incremental_watermark: minus("2026-10-05T15:00:00Z", WATERMARK_OVERLAP_MS), backfill_completed_at: at("2026-10-05T14:00:00Z") };
    expect(jobberUpdatedAt(state, at("2026-10-05T16:42:10Z"))).toBe(at("2026-10-05T16:42:10Z"));
  });

  it("while a re-import runs, keeps the last check and ignores the re-import's saves", () => {
    const start = "2026-10-05T15:00:00Z";
    const state = { incremental_watermark: minus(start, WATERMARK_OVERLAP_MS), backfill_completed_at: null };
    expect(jobberUpdatedAt(state, at("2026-10-05T16:00:00Z"))).toBe(at(start));
  });

  it("falls back to when the first import finished when no check time was saved", () => {
    expect(jobberUpdatedAt({ incremental_watermark: null, backfill_completed_at: at("2026-10-05T14:00:00Z") }, null))
      .toBe(at("2026-10-05T14:00:00Z"));
  });

  it("ignores values that are not times", () => {
    expect(jobberUpdatedAt({ incremental_watermark: "not a time", backfill_completed_at: 42 }, "nope")).toBeNull();
  });
});
