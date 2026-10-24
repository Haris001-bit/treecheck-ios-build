// Guard: Pulse's Jobber queries must not filter visits by isComplete. Jobber's API version 2026-09-25
// rejects it ("InputObject 'VisitFilterAttributes' doesn't accept argument 'isComplete'"), which broke the
// month-end forecast on Mark's real Jobber (2026-10-05). Completed visits are filtered by status, and
// scheduled visits skip completed ones in code. Checked live against the Jobber test account the same day.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "supabase/functions/_shared/pulse/jobberSync.ts"), "utf8");
// Every GraphQL `filter: { ... }` argument in the query strings (one level of nesting is enough here).
const filters = [...source.matchAll(/filter:\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => m[1]);

describe("Jobber query filters", () => {
  it("finds the visit filters to check", () => {
    expect(filters.length).toBeGreaterThanOrEqual(2);
  });

  it("never filter by isComplete", () => {
    for (const f of filters) expect(f).not.toMatch(/isComplete/);
  });

  it("completed visits are filtered by status, scheduled visits by date only", () => {
    expect(source).toMatch(/filter:\s*\{\s*status:\s*COMPLETED\s*\}/);
    expect(source).toMatch(/filter:\s*\{\s*startAt:\s*\{\s*after:\s*\$from,\s*before:\s*\$to\s*\}\s*\}/);
  });

  it("scheduled visits ask for isComplete so completed ones are skipped in code", () => {
    const scheduled = source.match(/SCHEDULED_VISITS_QUERY = `([\s\S]*?)`;/)?.[1] ?? "";
    expect(scheduled).toMatch(/\bisComplete\b/);
    expect(source).toMatch(/\.filter\(\(v: ScheduledVisitNode\) => v\.isComplete !== true\)/);
  });
});
