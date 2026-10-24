// Dates in the Pulse screen's row titles never split across lines on a narrow phone.
import { describe, expect, it } from "vitest";
import { keepTogether, weekdayDay } from "../../components/pulse/screen/pulseScreenTypes";

describe("keepTogether", () => {
  it("turns every space into a non-breaking space", () => {
    expect(keepTogether("by Oct 31")).toBe("by Oct 31");
    expect(keepTogether(weekdayDay("2026-10-23"))).toBe("Fri, Oct 23");
  });
  it("leaves text without spaces as it is", () => {
    expect(keepTogether("Oct")).toBe("Oct");
    expect(keepTogether("")).toBe("");
  });
});
