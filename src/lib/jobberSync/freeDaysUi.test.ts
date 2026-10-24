// How the screens read the jobber-free-days reply: only well-formed booked or closed days count, and
// anything unexpected means "nothing blocked" (the server still checks each pick).
import { describe, expect, it } from "vitest";
import { blockedDaysFrom, blockedLabel, blockedNote } from "@/lib/jobberFreeDays";

describe("blockedDaysFrom", () => {
  it("keeps booked and closed days", () => {
    const map = blockedDaysFrom({
      source: "jobber",
      blocked: [
        { date: "2026-10-12", status: "busy" },
        { date: "2026-10-15", status: "closed" },
        { date: "2026-10-16", status: "free" },
        { date: "Oct 17", status: "busy" },
        null,
      ],
    });
    expect([...map.entries()]).toEqual([["2026-10-12", "busy"], ["2026-10-15", "closed"]]);
  });

  it("gives nothing for an off switch or an odd reply", () => {
    expect(blockedDaysFrom({ source: "off", blocked: [] }).size).toBe(0);
    expect(blockedDaysFrom(null).size).toBe(0);
    expect(blockedDaysFrom({ error: "Not found" }).size).toBe(0);
  });

  it("labels each reason", () => {
    expect(blockedLabel("busy")).toBe("Booked");
    expect(blockedLabel("closed")).toBe("Closed");
    expect(blockedNote("busy")).toBe("already booked in Jobber");
    expect(blockedNote("closed")).toBe("the company is closed");
  });
});
