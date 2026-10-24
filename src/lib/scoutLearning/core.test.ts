import { describe, expect, it } from "vitest";
import {
  capText,
  GUIDANCE_MAX,
  guidanceOrEmpty,
  isUuid,
  LEARNING_FIELDS,
  positiveNumber,
  SCOUT_NOTES_MAX,
  scoutInputs,
  websiteFormInputs,
  withoutLearningFields,
} from "../../../supabase/functions/_shared/scoutLearningCore";

describe("scoutInputs: what Scout was given", () => {
  it("keeps sizes, notes, photos and the voice memo", () => {
    expect(scoutInputs({
      service: "Tree Removal", diameterInches: 24, circumferenceInches: "75", notes: "  Leaning over the fence. ",
      photoCount: 2, voiceMemo: true,
    })).toEqual({
      service: "Tree Removal", diameter_in: 24, circumference_in: 75, size_given: true,
      notes_given: true, notes: "Leaning over the fence.", photos: 2, voice_memo: true,
    });
  });

  it("treats blank, zero, NaN and text sizes as not given (Scout then prices from the photo alone)", () => {
    for (const blank of [null, undefined, "", " ", 0, "0", Number.NaN, "NaN", "big", -5]) {
      const r = scoutInputs({ diameterInches: blank, circumferenceInches: blank });
      expect([r.diameter_in, r.circumference_in, r.size_given]).toEqual([null, null, false]);
    }
  });

  it("counts a circumference alone as a size", () => {
    expect(scoutInputs({ circumferenceInches: 60 }).size_given).toBe(true);
  });

  it("caps the notes and marks missing notes", () => {
    expect(scoutInputs({ notes: "x".repeat(SCOUT_NOTES_MAX + 50) }).notes).toHaveLength(SCOUT_NOTES_MAX);
    expect(scoutInputs({ notes: "   " })).toMatchObject({ notes: null, notes_given: false });
  });

  it("never invents photos or a memo", () => {
    expect(scoutInputs({ photoCount: -1, voiceMemo: "yes" })).toMatchObject({ photos: 0, voice_memo: false });
    expect(scoutInputs({ photoCount: 1.5 }).photos).toBe(0);
  });
});

describe("websiteFormInputs keeps only sizes and yes/no facts", () => {
  it("keeps the whitelisted keys in either spelling", () => {
    expect(websiteFormInputs({
      trunkDiameter: "18", treeHeight: 40, stump_diameter: "", has_photo: true, notesGiven: false,
    })).toEqual({ trunk_diameter: "18", tree_height: 40, has_photo: true, notes_given: false });
  });

  it("drops customer details, long text, objects and anything unknown", () => {
    expect(websiteFormInputs({
      customer_name: "Jane", customerPhone: "555", email: "a@b.c", address: "1 Main St",
      tree_height: "x".repeat(41), trunk_diameter: { inches: 20 }, stumpDiameter: Number.POSITIVE_INFINITY,
    })).toEqual({});
  });

  it("handles junk input", () => {
    for (const junk of [null, undefined, "text", 5, [1, 2]]) expect(websiteFormInputs(junk)).toEqual({});
  });
});

describe("withoutLearningFields", () => {
  it("removes exactly the learning fields and keeps the rest, without changing the original", () => {
    expect(LEARNING_FIELDS).toEqual(["ai_notes", "form_inputs", "learning_version"]);
    const payload = { city: "Edmond", ai_notes: "stump left", form_inputs: { stumpDiameter: 20 }, learning_version: "v", customer_notes: "hi" };
    expect(withoutLearningFields(payload)).toEqual({ city: "Edmond", customer_notes: "hi" });
    expect(payload.ai_notes).toBe("stump left");
  });
});

describe("small helpers", () => {
  it("positiveNumber", () => {
    expect([positiveNumber(3), positiveNumber("4.5"), positiveNumber(0), positiveNumber("-1"), positiveNumber(null)]).toEqual([3, 4.5, null, null, null]);
  });

  it("capText", () => {
    expect([capText("  ab  ", 1), capText("", 5), capText(5, 5)]).toEqual(["a", null, null]);
  });

  it("guidanceOrEmpty trims, caps and gives an empty string for none", () => {
    expect(guidanceOrEmpty("  block ")).toBe("block");
    expect(guidanceOrEmpty("x".repeat(GUIDANCE_MAX + 1))).toHaveLength(GUIDANCE_MAX);
    expect([guidanceOrEmpty(null), guidanceOrEmpty(undefined), guidanceOrEmpty(7)]).toEqual(["", "", ""]);
  });

  it("isUuid", () => {
    expect(isUuid("705cecc2-5926-48c1-a728-b3ebd6b920a2")).toBe(true);
    expect([isUuid("705cecc2"), isUuid(null), isUuid("705cecc2-5926-48c1-a728-b3ebd6b920a2 ")]).toEqual([false, false, false]);
  });
});
