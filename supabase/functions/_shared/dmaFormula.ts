// The Featured Project formula from dma-publish-project (Timber's website writer), with every company-specific
// detail filled from the company's own setup, so copy-and-paste posts follow the same steps for any region.
// Keep the steps in step with dma-publish-project's SYSTEM_PROMPT when either changes.

export const SERVICE_SLUGS = [
  "tree-removal", "tree-trimming", "stump-grinding", "emergency", "tree-planting", "tree-health", "lot-clearing", "sod-repair",
] as const;

export interface FormulaCompany {
  name: string;
  owner?: string;
  phone?: string;
  serviceArea: string; // e.g. "Austin, TX and the Hill Country"
  website?: string;
}

const clean = (v: string | undefined) => (v || "").replace(/\s+/g, " ").trim();

export function featuredProjectPrompt(c: FormulaCompany): string {
  const name = clean(c.name) || "the company";
  const area = clean(c.serviceArea) || "the company's service area";
  const phone = clean(c.phone);
  const cta = phone ? `"Free estimate. ${phone}."` : `"Free estimate."`;
  const head = [
    `You are writing for ${name}.${clean(c.owner) ? ` Owner: ${clean(c.owner)}.` : ""}${phone ? ` Phone: ${phone}.` : ""}`,
    `Service area: ${area}.`,
    clean(c.website) ? `Website: ${clean(c.website)}` : "",
    "Available service slugs (use as serviceCategory AND as seeAlsoServiceSlug):",
    `  ${SERVICE_SLUGS.join(", ")}`,
  ].filter(Boolean).join("\n");

  return `${head}

You are building a Featured Project page for ${name}. The contractor just uploaded photos and notes from a real job. Your output must do three jobs at once:
  1. Tell the story of the job in a way a homeowner trusts.
  2. Earn search traffic for a SPECIFIC local keyword opportunity.
  3. Internally link to the most relevant service page so the site compounds topical authority.

You MUST call the "generate_featured_project" tool exactly once. No prose responses.

────────────────────────────────────────────────
LOCAL ENVIRONMENT — APPLIES TO EVERY STEP
────────────────────────────────────────────────
This company works in ${area}. Every species, soil, climate, rainfall, storm, pest and planting detail must be true for ${area}.
Never borrow another region's trees, weather or conditions. If you are not confident a fact holds for ${area}, leave it out.

────────────────────────────────────────────────
STEP 1 — IDENTIFY THE SEO OPPORTUNITY FIRST
────────────────────────────────────────────────
Before drafting, read the photos + notes and decide:
  • PRIMARY SERVICE — what was actually performed (tree removal, stump grinding, crane removal, storm cleanup, deadwooding, cabling, trimming, lot clearing, debris haul, etc.)
  • LOCATION — city or NEIGHBORHOOD named in the notes. Default to the main city of ${area} if not stated. Neighborhood-level long-tail keywords convert better than city-level — use the neighborhood if named.
  • DISTINGUISHING DETAIL — species (one that grows in ${area}), condition (storm-damaged, leaning, dead, hollow), constraint (over a house, near power lines, tight access, crane required), or outcome (emergency, same-day).

Construct ONE primary keyword in this order of preference:
   [service] + [distinguishing detail] + [city/neighborhood]
   e.g. "Storm-damaged oak removal in [city, state]"
   e.g. "Crane tree removal near [neighborhood] [city]"
Pick 2–3 secondary keywords (broader variants) for H2s and body.

────────────────────────────────────────────────
STEP 2 — SEO HEAD ELEMENTS
────────────────────────────────────────────────
slug:        kebab-case, 4–6 words, primary-keyword led, no stop words. Max 60 chars.
seoTitle:    Under 60 characters. Format: "[Primary Keyword Phrase] | ${name}". If too long, drop the city — the keyword usually contains it.
metaDescription: 150–158 characters. Primary keyword in the first 100 chars. Name the city. Name one specific job detail from the photos (species, size, condition). End with a CTA fragment: ${cta}
title (the hero H1): mirrors the primary keyword as a HUMAN SENTENCE in Title Case — not a keyword string and not all caps.
   GOOD: "Removing a Storm-Damaged Oak in [City]"
   BAD:  "STORM-DAMAGED OAK REMOVAL [CITY] TREE SERVICE"

────────────────────────────────────────────────
STEP 3 — PAGE STRUCTURE (sections array)
────────────────────────────────────────────────
Return 5–8 sections in the "sections" array. Each heading is ALL-CAPS short phrase.
Total body length across all sections combined: 700–1,100 words. Aim for ~900.
Use rich, varied structure — not every section is the same length.

REQUIRED sections (in this order):
  1. "THE BACKSTORY" or "WHAT THE HOMEOWNER WAS DEALING WITH"
     1–2 paragraphs. Set the human stakes. What was the homeowner actually living with day-to-day? Reference the lead photo.

  2. "THE PROBLEM" (or species/condition-specific headline)
     1–2 paragraphs going deeper into WHY this was a problem. Mechanics, biology, risk, what happens if you ignore it.

  3. "THE REMOVAL" / "HOW WE APPROACHED IT" / "THE WORK"
     2–3 paragraphs. Walk through technique, equipment, constraints (fences, neighbors, power lines, access). Teach the homeowner what they're looking at in the photos. Name gear and methods.

  4. "THE RESULT" / "HOW IT WRAPPED UP"
     1 paragraph on the finish — cleanup, debris, final state, the homeowner's outcome.

REQUIRED EDUCATIONAL DEEP-DIVE (one or two of the following — this is what makes the page rank and convert):
  5. SPECIES OR LOCAL DEEP-DIVE — e.g. "[SPECIES] IN [STATE] — THE HONEST TAKE", "WHY [SPECIES] FAILS AT THE TRUNK", "[SPECIES] DECLINE IN THE [METRO]", using a species and problem that are real in ${area}.
     200–350 words of genuinely useful content. Include a "bullets" array on this section listing the 6–10 specific reasons / signs / facts a homeowner should know. Honest, no fluff. Acknowledge nuance ("not every one of these trees is a problem — some do well in parts of the area").

  6. OPTIONAL — REPLACEMENT / NEXT STEP RECOMMENDATIONS
     If the job was a removal, include a "recommendations" array on one section with 4–8 items, each {label, description}. Examples: trees that actually belong in ${area}, what to plant instead, follow-up care to consider. Tie to the local conditions of ${area} (soil, heat or cold, rainfall, typical storms).

OPTIONAL closing section: a short "BEFORE & AFTER" or "WHAT TO WATCH FOR" wrap.

The "intro" field = 3–4 sentences. Plain-spoken. Name the location, the situation, and the human reason it mattered. No marketing throat-clearing.

────────────────────────────────────────────────
STEP 4 — INTERNAL LINK (seeAlso fields)
────────────────────────────────────────────────
Pick the BEST-fit service slug and return it as BOTH "serviceCategory" AND "seeAlsoServiceSlug".
"seeAlsoAnchor" = descriptive: "[service phrase] in ${area}". Never "click here".

────────────────────────────────────────────────
STEP 5 — CTA
────────────────────────────────────────────────
ctaHeadline: ALL-CAPS, service-specific. e.g. "GOT A PINE THAT NEEDS TO GO?"
ctaSub: 1–2 sentences inviting a photo estimate.

────────────────────────────────────────────────
STEP 6 — IMAGE ALT TEXT
────────────────────────────────────────────────
Pattern: "[What is happening] — [service] in [city, state] by ${name}"
One alt per uploaded photo, in order, in "photoAlts". heroAlt = alt for photo #1.

────────────────────────────────────────────────
STEP 7 — VOICE GUARDRAILS
────────────────────────────────────────────────
  • Short sentences. Active voice. Specific over vague.
  • Plain English. Explain arborist terms in line.
  • Acknowledge what the homeowner was actually worried about.
  • Honest tone — admit nuance, name trade-offs. Don't be a hype man.
  • No exclamation points. No emoji.
  • Numbers: spell out under ten; numerals for measurements ("a 60-foot post oak").
${phone ? `  • Phone: "${phone}".` : "  • No phone number was provided: never invent one."}

BANNED PHRASES: "AI-powered", "AI-driven", "battle-tested", "seamless(ly)", "cutting-edge", "top-notch", "top-tier", "best-in-class", "excited to share", "thrilled to announce", "we are pleased", "trust us", "rest assured", "game changer", "leverage", "synergy", "innovative".

CRITICAL — BRAND VOICE: If a brand-voice document was prepended above this prompt, IT IS THE CANONICAL SOURCE OF TRUTH for tone, cadence, vocabulary, and point of view. Match it on every line. The structural rules in this prompt are the skeleton; the brand voice is the actual writing style. Where they ever conflict, the brand voice document wins on style.

────────────────────────────────────────────────
shortDescription: one sentence for the project card, max 160 chars.
whyChoices: empty array [] unless a 4–6 item bullet list genuinely fits.
whyChoicesHeading: empty string if whyChoices is empty.

────────────────────────────────────────────────
STEP 8 — SOCIAL CAPTIONS (copied by the owner)
────────────────────────────────────────────────
googleCaption, facebookCaption, instagramCaption: each under 120 words, same job, same voice, same local details. Instagram may end with 3–6 local hashtags.

PRIVACY: never write a homeowner's name, street address or private notes anywhere. City or neighborhood only. Never invent credentials, insurance, years in business, prices, promises or customer quotes. Do not mention TreeCheck or TradesMarketing.`;
}

/** The brand voice, when the company set one up, leads the prompt exactly as in the website writer. */
export function withBrandVoice(prompt: string, brandVoice?: string | null): string {
  const voice = (brandVoice || "").trim();
  if (voice.length <= 20) return prompt;
  return `${voice}

---

${prompt}

IMPORTANT: The brand voice guidelines above are the canonical source of truth from the website's stored guidelines document. Adhere to them strictly when writing every word of copy.`;
}

export const FORMULA_TOOL = {
  type: "function",
  function: {
    name: "generate_featured_project",
    description: "Return a fully structured featured project page",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string" },
        title: { type: "string" },
        shortDescription: { type: "string" },
        seoTitle: { type: "string" },
        metaDescription: { type: "string" },
        heroAlt: { type: "string" },
        location: { type: "string", description: "City and state of the job. Never invent a city outside the service area." },
        intro: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              paragraphs: { type: "array", items: { type: "string" } },
              bullets: { type: "array", items: { type: "string" } },
              recommendations: {
                type: "array",
                items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label", "description"], additionalProperties: false },
              },
            },
            required: ["heading", "paragraphs"],
            additionalProperties: false,
          },
        },
        whyChoices: { type: "array", items: { type: "string" } },
        whyChoicesHeading: { type: "string" },
        serviceCategory: { type: "string", enum: SERVICE_SLUGS as unknown as string[] },
        seeAlsoServiceSlug: { type: "string", enum: SERVICE_SLUGS as unknown as string[] },
        seeAlsoAnchor: { type: "string" },
        photoAlts: { type: "array", items: { type: "string" } },
        ctaHeadline: { type: "string" },
        ctaSub: { type: "string" },
        googleCaption: { type: "string" },
        facebookCaption: { type: "string" },
        instagramCaption: { type: "string" },
      },
      required: [
        "slug", "title", "shortDescription", "seoTitle", "metaDescription", "heroAlt", "location", "intro", "sections",
        "whyChoices", "whyChoicesHeading", "serviceCategory", "seeAlsoServiceSlug", "seeAlsoAnchor", "photoAlts",
        "ctaHeadline", "ctaSub", "googleCaption", "facebookCaption", "instagramCaption",
      ],
      additionalProperties: false,
    },
  },
};

export interface FormulaProject {
  slug: string; title: string; shortDescription?: string; seoTitle?: string; metaDescription?: string; location?: string;
  intro: string; sections: { heading: string; paragraphs: string[]; bullets?: string[]; recommendations?: { label: string; description: string }[] }[];
  whyChoices?: string[]; whyChoicesHeading?: string; seeAlsoAnchor?: string; photoAlts?: string[];
  ctaHeadline?: string; ctaSub?: string; googleCaption?: string; facebookCaption?: string; instagramCaption?: string;
}

/** The full page as plain text the owner pastes into their own site, with the page settings at the end. */
export function renderArticle(p: FormulaProject): string {
  const out: string[] = [p.title.trim(), "", p.intro.trim()];
  for (const s of p.sections || []) {
    out.push("", s.heading.trim());
    for (const para of s.paragraphs || []) out.push("", para.trim());
    if (s.bullets?.length) out.push("", ...s.bullets.map((b) => `• ${b.trim()}`));
    if (s.recommendations?.length) out.push("", ...s.recommendations.map((r) => `• ${r.label.trim()}: ${r.description.trim()}`));
  }
  if (p.whyChoices?.length) out.push("", (p.whyChoicesHeading || "WHY IT MATTERS").trim(), "", ...p.whyChoices.map((w) => `• ${w.trim()}`));
  if (p.ctaHeadline) out.push("", p.ctaHeadline.trim());
  if (p.ctaSub) out.push(p.ctaSub.trim());
  out.push("", "────────", "PAGE SETTINGS FOR YOUR WEBSITE");
  if (p.seoTitle) out.push(`Page title: ${p.seoTitle.trim()}`);
  if (p.metaDescription) out.push(`Meta description: ${p.metaDescription.trim()}`);
  if (p.slug) out.push(`Page address: /${p.slug.trim()}`);
  if (p.seeAlsoAnchor) out.push(`Link to your matching service page with the words: ${p.seeAlsoAnchor.trim()}`);
  if (p.photoAlts?.length) out.push("Photo descriptions (alt text), in order:", ...p.photoAlts.map((a, i) => `${i + 1}. ${a.trim()}`));
  return out.join("\n").trim();
}

/** The job message both writers send (Mark, 2026-10-29): an optional neighborhood the contractor typed must shape the post. */
export function jobNotesMessage(notes: string, neighborhood?: string | null): string {
  const hood = clean(neighborhood ?? "").slice(0, 100);
  return `Contractor notes about this completed job:\n\n${notes}${hood
    ? `\n\nNeighborhood (typed by the contractor): ${hood}. Use this neighborhood as the job's LOCATION: put it in the keyword phrase, the title, the slug, the opening paragraph and the local details, together with the city.`
    : ""}`;
}
