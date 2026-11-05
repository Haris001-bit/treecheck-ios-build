import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { featuredProjectPrompt, jobNotesMessage, renderArticle } from "./dmaFormula.ts";

Deno.test("a Texas company's formula names its own area and never Timber or Oklahoma", () => {
  const p = featuredProjectPrompt({ name: "Hill Country Trees", phone: "(512) 555-0100", serviceArea: "Austin, TX" });
  assert(p.includes("Austin, TX"));
  assert(p.includes("| Hill Country Trees"));
  assert(p.includes("(512) 555-0100"));
  for (const leak of ["Timber", "Oklahoma", "Edmond", "OKC", "405"]) assert(!p.includes(leak), leak);
});

Deno.test("keeps the website formula's structure", () => {
  const p = featuredProjectPrompt({ name: "A", serviceArea: "Boise, ID" });
  for (const step of ["STEP 1", "STEP 2", "STEP 3", "STEP 4", "STEP 5", "STEP 6", "STEP 7", "700–1,100 words", "recommendations"]) assert(p.includes(step), step);
  assert(p.includes("never invent one"));
});

Deno.test("renders sections, bullets and recommendations into the pasted article", () => {
  const a = renderArticle({ slug: "x-y", title: "T", intro: "I.", sections: [{ heading: "H", paragraphs: ["P."], bullets: ["b"], recommendations: [{ label: "Live oak", description: "d" }] }], seoTitle: "S" });
  assertEquals(a.split("\n")[0], "T");
  assert(a.includes("• b") && a.includes("• Live oak: d") && a.includes("Page title: S") && a.includes("Page address: /x-y"));
});

Deno.test("a typed neighborhood goes into the job message and becomes the post's location", () => {
  const m = jobNotesMessage("Removed a leaning tree.", "  Deer Creek  ");
  assert(m.includes("Neighborhood (typed by the contractor): Deer Creek."));
  assert(m.includes("keyword phrase") && m.includes("title"));
});

Deno.test("no neighborhood leaves the job message unchanged", () => {
  assertEquals(jobNotesMessage("Removed a leaning tree.", ""), "Contractor notes about this completed job:\n\nRemoved a leaning tree.");
  assertEquals(jobNotesMessage("Removed a leaning tree."), "Contractor notes about this completed job:\n\nRemoved a leaning tree.");
});
