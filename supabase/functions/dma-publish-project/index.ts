// Digital Marketing Agent — Publish Project to Timber Tree Services site
// Generates a featured project page from photos + notes and commits it to the
// GitHub repo (LaffyCaffi/timber-roots-ai). Netlify auto-rebuilds on push.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { DEMO_OWNER_ID, demoPostUrl, liveSince } from "../_shared/demoCompany.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REPO_OWNER = "LaffyCaffi";
const REPO_NAME = "timber-roots-ai";
const REPO_BRANCH = "main";

const SERVICE_SLUGS = [
  "tree-removal",
  "tree-trimming",
  "stump-grinding",
  "emergency",
  "tree-planting",
  "tree-health",
  "lot-clearing",
  "sod-repair",
] as const;
type ServiceSlug = (typeof SERVICE_SLUGS)[number];

const BRAND_VOICE = `
You are writing for Timber Tree Service of Edmond, Oklahoma. Owner: Mark Cafiero. Phone: (405) 253-5232.
Service area: Edmond, Oklahoma City, and surrounding OKC metro.
Website: https://timberedmond.com  •  Estimate page: /estimate/
Available service slugs (use as serviceCategory AND as seeAlsoServiceSlug):
  tree-removal, tree-trimming, stump-grinding, emergency, tree-planting, tree-health, lot-clearing, sod-repair
`.trim();

const SYSTEM_PROMPT = `${BRAND_VOICE}

You are building a Featured Project page for Timber Tree Service. The contractor just uploaded photos and a voice memo from a real job. Your output must do three jobs at once:
  1. Tell the story of the job in a way a homeowner trusts.
  2. Earn search traffic for a SPECIFIC local keyword opportunity.
  3. Internally link to the most relevant service page so the site compounds topical authority.

You MUST call the "generate_featured_project" tool exactly once. No prose responses.

────────────────────────────────────────────────
STEP 1 — IDENTIFY THE SEO OPPORTUNITY FIRST
────────────────────────────────────────────────
Before drafting, read the photos + notes and decide:
  • PRIMARY SERVICE — what was actually performed (tree removal, stump grinding, crane removal, storm cleanup, deadwooding, cabling, trimming, lot clearing, debris haul, etc.)
  • LOCATION — city or NEIGHBORHOOD named in the memo. Default to Edmond, OK if not stated. Neighborhood-level long-tail keywords convert better than city-level — use the neighborhood if named.
  • DISTINGUISHING DETAIL — species (bradford pear, post oak, pine), condition (storm-damaged, leaning, dead, hollow), constraint (over a house, near power lines, tight access, crane required), or outcome (emergency, same-day).

Construct ONE primary keyword in this order of preference:
   [service] + [distinguishing detail] + [city/neighborhood]
   e.g. "Storm-damaged oak removal in Edmond, OK"
   e.g. "Crane tree removal near Deer Creek Edmond"
Pick 2–3 secondary keywords (broader variants) for H2s and body.

────────────────────────────────────────────────
STEP 2 — SEO HEAD ELEMENTS
────────────────────────────────────────────────
slug:        kebab-case, 4–6 words, primary-keyword led, no stop words. Max 60 chars.
seoTitle:    Under 60 characters. Format: "[Primary Keyword Phrase] | Timber Tree Service". If too long, drop the city — the keyword usually contains it. (NOTE: this overrides the older ALL-CAPS title style.)
metaDescription: 150–158 characters. Primary keyword in the first 100 chars. Name the city. Name one specific job detail from the photos (species, size, condition). End with a CTA fragment: "Free estimate. (405) 253-5232."
title (the hero H1): mirrors the primary keyword as a HUMAN SENTENCE in Title Case — not a keyword string and not all caps.
   GOOD: "Removing a Storm-Damaged Oak in Edmond"
   BAD:  "STORM-DAMAGED OAK REMOVAL EDMOND OK TREE SERVICE"

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
  5. SPECIES OR LOCAL DEEP-DIVE — e.g. "PINE TREES IN OKLAHOMA — THE HONEST TAKE", "WHY BRADFORD PEARS ALMOST ALWAYS FAIL AT THE TRUNK", "POST OAK DECLINE IN THE OKC METRO".
     200–350 words of genuinely useful content. Include a "bullets" array on this section listing the 6–10 specific reasons / signs / facts a homeowner should know. Honest, no fluff. Acknowledge nuance ("not all pines are bad — loblollies do well in eastern Oklahoma").

  6. OPTIONAL — REPLACEMENT / NEXT STEP RECOMMENDATIONS
     If the job was a removal, include a "recommendations" array on one section with 4–8 items, each {label, description}. Examples: trees that actually belong in central Oklahoma, what to plant instead, follow-up care to consider. Tie to local conditions (clay soil, heat, ice storms).

OPTIONAL closing section: a short "BEFORE & AFTER" or "WHAT TO WATCH FOR" wrap.

The "intro" field = 3–4 sentences. Plain-spoken. Name the location, the situation, and the human reason it mattered. No marketing throat-clearing.

────────────────────────────────────────────────
STEP 4 — INTERNAL LINK (seeAlso fields)
────────────────────────────────────────────────
Pick the BEST-fit service slug and return it as BOTH "serviceCategory" AND "seeAlsoServiceSlug".
"seeAlsoAnchor" = descriptive: "[service phrase] in Edmond and Oklahoma City". Never "click here".

────────────────────────────────────────────────
STEP 5 — CTA
────────────────────────────────────────────────
ctaHeadline: ALL-CAPS, service-specific. e.g. "GOT A PINE THAT NEEDS TO GO?"
ctaSub: 1–2 sentences inviting a photo estimate.

────────────────────────────────────────────────
STEP 6 — IMAGE ALT TEXT
────────────────────────────────────────────────
Pattern: "[What is happening] — [service] in [city], OK by Timber Tree Service"
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
  • Phone: "(405) 253-5232".

BANNED PHRASES: "AI-powered", "AI-driven", "battle-tested", "seamless(ly)", "cutting-edge", "top-notch", "top-tier", "best-in-class", "excited to share", "thrilled to announce", "we are pleased", "trust us", "rest assured", "game changer", "leverage", "synergy", "innovative".

CRITICAL — BRAND VOICE: If a brand-voice document was prepended above this prompt, IT IS THE CANONICAL SOURCE OF TRUTH for tone, cadence, vocabulary, and point of view. Match it on every line. The structural rules in this prompt are the skeleton; the brand voice is the actual writing style. Where they ever conflict, the brand voice document wins on style.

────────────────────────────────────────────────
shortDescription: one sentence for the project card, max 160 chars.
whyChoices: empty array [] unless a 4–6 item bullet list genuinely fits.
whyChoicesHeading: empty string if whyChoices is empty.
`.trim();

const GENERATOR_TOOL = {
  type: "function",
  function: {
    name: "generate_featured_project",
    description: "Return a fully structured featured project page",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "kebab-case URL slug, primary-keyword led, max 60 chars" },
        title: { type: "string", description: "Hero H1 — Title Case human sentence mirroring the primary keyword (NOT all caps)" },
        shortDescription: { type: "string", description: "Single sentence for project card, max 160 chars" },
        seoTitle: { type: "string", description: "Under 60 chars: '[Primary Keyword] | Timber Tree Service'" },
        metaDescription: { type: "string", description: "150-158 chars. Primary keyword in first 100 chars. Ends with 'Free estimate. (405) 253-5232.'" },
        heroAlt: { type: "string" },
        location: { type: "string", description: "City and state abbreviation of the job, e.g. 'Guthrie, OK'. Use the city/neighborhood named in the memo; otherwise the contractor's primary service city from the brand voice. Never invent a city from another state." },
        intro: { type: "string", description: "2-3 sentence opening narrative" },
        sections: {
          type: "array",
          description: "5–8 sections. Required order: backstory, problem, work/approach, result, plus at least one educational deep-dive section (with bullets) and optionally a recommendations section.",
          items: {
            type: "object",
            properties: {
              heading: { type: "string", description: "ALL-CAPS short phrase" },
              paragraphs: { type: "array", items: { type: "string" } },
              bullets: { type: "array", items: { type: "string" }, description: "Optional. 6–10 short bullet points for educational deep-dive sections." },
              recommendations: {
                type: "array",
                description: "Optional. 4–8 recommendation cards (e.g. replacement tree species).",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["heading", "paragraphs"],
            additionalProperties: false,
          },
        },
        whyChoices: { type: "array", items: { type: "string" }, description: "Usually empty []. Only populate with 4-6 items if genuinely useful." },
        whyChoicesHeading: { type: "string", description: "Empty string if whyChoices is empty" },
        serviceCategory: { type: "string", enum: SERVICE_SLUGS as unknown as string[] },
        seeAlsoServiceSlug: { type: "string", enum: SERVICE_SLUGS as unknown as string[], description: "Same as serviceCategory in most cases — the matched service slug" },
        seeAlsoAnchor: { type: "string", description: "Descriptive anchor text, e.g. 'professional storm tree removal in Edmond and Oklahoma City'" },
        photoAlts: { type: "array", items: { type: "string" }, description: "One alt text per uploaded photo, in order" },
        ctaHeadline: { type: "string", description: "ALL-CAPS, service-specific, e.g. 'GET A FREE ESTIMATE ON YOUR TREE REMOVAL'" },
        ctaSub: { type: "string", description: "Two sentences max, tied to the exact service" },
      },
      required: [
        "slug", "title", "shortDescription", "seoTitle", "metaDescription",
        "heroAlt", "location", "intro", "sections", "whyChoices", "whyChoicesHeading",
        "serviceCategory", "seeAlsoServiceSlug", "seeAlsoAnchor",
        "photoAlts", "ctaHeadline", "ctaSub",
      ],
      additionalProperties: false,
    },
  },
};

interface PublishRequest {
  notes?: string;
  photo_paths?: string[]; // storage paths in lead-photos bucket, e.g. "dma/<jobId>/photo1.jpg"
  // Revision mode: fix an already-published post from a casual voice memo.
  project_id?: string;
  voice_memo_path?: string; // storage path in lead-photos bucket
  transcript?: string; // optional pre-transcribed correction
  // Re-push the already-generated copy to the site (same slug, no AI, no new post).
  republish?: boolean;
}

/** Transcribe a stored voice memo with Lovable AI speech-to-text. */
async function transcribeMemo(
  adminClient: ReturnType<typeof createClient>,
  path: string,
  apiKey: string,
): Promise<string> {
  const { data, error } = await adminClient.storage.from("lead-photos").download(path);
  if (error || !data) throw new Error(`Could not read voice memo: ${error?.message ?? "missing"}`);
  const ext = (path.split(".").pop() || "webm").toLowerCase();
  const form = new FormData();
  form.append("model", "openai/gpt-4o-transcribe");
  form.append("file", data, `memo.${ext}`);
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Transcription failed (${resp.status}): ${text.slice(0, 300)}`);
  let json: { text?: string } = {};
  try { json = JSON.parse(text); } catch { /* fall through */ }
  return (json.text ?? "").trim();
}


interface GeneratedProject {
  slug: string;
  title: string;
  shortDescription: string;
  seoTitle: string;
  metaDescription: string;
  heroAlt: string;
  location?: string;
  intro: string;
  sections: {
    heading: string;
    paragraphs: string[];
    bullets?: string[];
    recommendations?: { label: string; description: string }[];
  }[];
  whyChoices: string[];
  whyChoicesHeading: string;
  serviceCategory: ServiceSlug;
  seeAlsoServiceSlug: ServiceSlug;
  seeAlsoAnchor: string;
  photoAlts: string[];
  ctaHeadline: string;
  ctaSub: string;
}

function pascalCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join("");
}

function escapeForJsx(s: string): string {
  // For text inside JSX (between tags). Quotes inside JSX text are fine.
  return s.replace(/'/g, "\u2019"); // smart apostrophe to dodge JSX quote issues
}

function escapeForJsxString(s: string): string {
  // For values inside double-quoted JSX attributes
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildProjectTsx(p: GeneratedProject, photoFilenames: string[]): string {
  const componentName = `Project${pascalCase(p.slug)}`;
  const heroFile = photoFilenames[0];
  const otherFiles = photoFilenames.slice(1);

  const imports = [
    `import { Link } from 'react-router-dom';`,
    `import { ArrowLeft, ArrowRight, Phone, CheckCircle } from 'lucide-react';`,
    `import SEOHead from '@/components/SEOHead';`,
    `import EstimateCTA from '@/components/EstimateCTA';`,
    `import { PHONE, PHONE_TEL } from '@/data/schema';`,
    ``,
    `import heroImg from '@/assets/projects/${p.slug}/${heroFile}';`,
    ...otherFiles.map(
      (f, i) => `import photo${i + 2} from '@/assets/projects/${p.slug}/${f}';`,
    ),
  ].join("\n");

  // Build the body image pool. The cover (heroImg) is ONLY used in the hero
  // band and the CTA band — it is NEVER shown in the body. The remaining
  // photos appear in the body in the EXACT order the contractor arranged
  // them on the submission screen (photo2, photo3, photo4, ...).
  const bodyImageRefs: { ref: string; alt: string }[] = otherFiles.map((_, i) => ({
    ref: `photo${i + 2}`,
    alt: p.photoAlts[i + 1] || p.heroAlt,
  }));

  const renderImageBlock = (ref: string, alt: string, bg: string) =>
    `    <section className="timber-section ${bg}">
      <div className="timber-container max-w-4xl">
        <img
          loading="lazy"
          src={${ref}}
          alt="${escapeForJsxString(alt)}"
          className="mx-auto w-auto max-w-full max-h-[70vh] rounded-xl shadow-lg"
        />
      </div>
    </section>`;

  // Interleave: section, image, section, image, ... so photos sprinkle through.
  const interleaved: string[] = [];
  let imgCursor = 0;
  p.sections.forEach((sec, idx) => {
    const bg = idx % 2 === 0 ? "bg-background" : "bg-muted";
    const paras = sec.paragraphs
      .map(
        (para, i) =>
          `        <p className="timber-body text-muted-foreground${i < sec.paragraphs.length - 1 ? " mb-4" : ""}">${escapeForJsx(para)}</p>`,
      )
      .join("\n");

    const bulletsJsx = sec.bullets && sec.bullets.length > 0
      ? `\n        <ul className="mt-6 space-y-2 list-disc pl-6">
${sec.bullets.map((b) => `          <li className="timber-body text-muted-foreground">${escapeForJsx(b)}</li>`).join("\n")}
        </ul>`
      : "";

    const recsJsx = sec.recommendations && sec.recommendations.length > 0
      ? `\n        <div className="mt-6 grid gap-4 sm:grid-cols-2">
${sec.recommendations.map((r) => `          <div className="rounded-lg bg-card p-4 border border-border">
            <h3 className="font-semibold text-foreground mb-1">${escapeForJsx(r.label)}</h3>
            <p className="text-sm text-muted-foreground">${escapeForJsx(r.description)}</p>
          </div>`).join("\n")}
        </div>`
      : "";

    interleaved.push(`    <section className="timber-section ${bg}">
      <div className="timber-container max-w-3xl">
        <h2 className="timber-heading-2 text-foreground mb-6">${escapeForJsx(sec.heading)}</h2>
${paras}${bulletsJsx}${recsJsx}
      </div>
    </section>`);

    // Drop an image after this section (skip after the very last section so
    // CTA follows the closing copy directly).
    if (idx < p.sections.length - 1 && imgCursor < bodyImageRefs.length) {
      const imgBg = idx % 2 === 0 ? "bg-muted" : "bg-background";
      const { ref, alt } = bodyImageRefs[imgCursor++];
      interleaved.push(renderImageBlock(ref, alt, imgBg));
    }
  });

  // Any leftover images after the last section go just before the why/CTA.
  const leftoverImagesJsx = bodyImageRefs
    .slice(imgCursor)
    .map((b, i) => renderImageBlock(b.ref, b.alt, i % 2 === 0 ? "bg-background" : "bg-muted"))
    .join("\n\n");

  const sectionsJsx = interleaved.join("\n\n");

  const whyJsx =
    p.whyChoices.length > 0
      ? `\n    <section className="timber-section bg-muted">
      <div className="timber-container max-w-3xl">
        <h2 className="timber-heading-2 text-foreground mb-6">${escapeForJsx(p.whyChoicesHeading)}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
${p.whyChoices.map((c) => `            ${JSON.stringify(escapeForJsx(c))},`).join("\n")}
          ].map(item => (
            <div key={item} className="flex items-start gap-3 rounded-lg bg-card p-4">
              <CheckCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <span className="text-foreground text-sm">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>\n`
      : "";

  const extraPhotoJsx = leftoverImagesJsx;

  const seeAlsoSlug = p.seeAlsoServiceSlug || p.serviceCategory;
  const seeAlsoAnchor = p.seeAlsoAnchor || `learn more about our ${p.serviceCategory.replace(/-/g, " ")} services`;
  const seeAlsoJsx = `\n    <section className="timber-section bg-background">
      <div className="timber-container max-w-3xl">
        <h2 className="timber-heading-2 text-foreground mb-4">SEE ALSO</h2>
        <p className="timber-body text-muted-foreground">
          Need this kind of work at your place? Read more about <Link to="/services/${seeAlsoSlug}/" className="text-primary underline underline-offset-2 hover:no-underline">${escapeForJsx(seeAlsoAnchor)}</Link>.
        </p>
      </div>
    </section>\n`;

  return `import React from 'react';
${imports}

const ${componentName} = () => (
  <>
    <SEOHead
      title="${escapeForJsxString(p.seoTitle)}"
      description="${escapeForJsxString(p.metaDescription)}"
      canonical="https://timberedmond.com/projects/${p.slug}/"
    />

    {/* Hero */}
    <section className="relative min-h-[45vh] flex items-center overflow-hidden">
      <img
        loading="eager"
        src={heroImg}
        alt="${escapeForJsxString(p.heroAlt)}"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-secondary/50" />
      <div className="relative timber-container px-4 py-20">
        <Link to="/projects/" className="inline-flex items-center gap-1 text-sm text-secondary-foreground/70 hover:text-secondary-foreground mb-4 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Featured Projects
        </Link>
        <h1 className="timber-heading-1 text-secondary-foreground mb-4">
          ${escapeForJsx(p.title)}
        </h1>
        <p className="timber-body text-secondary-foreground/80 max-w-2xl">
          ${escapeForJsx(p.intro)}
        </p>
      </div>
    </section>

${sectionsJsx}
${whyJsx}
${extraPhotoJsx}
${seeAlsoJsx}

    {/* CTA */}
    <section className="relative overflow-hidden px-4 py-16">
      <img loading="lazy" src={heroImg} alt="Timber Tree Service" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-secondary/85" />
      <div className="relative timber-container text-center">
        <h2 className="timber-heading-2 text-secondary-foreground mb-4">${escapeForJsx(p.ctaHeadline)}</h2>
        <p className="timber-body text-secondary-foreground/80 mb-8 max-w-2xl mx-auto">
          ${escapeForJsx(p.ctaSub)}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href={PHONE_TEL} className="timber-btn-accent text-base"><Phone className="h-5 w-5" /> Call or Text {PHONE}</a>
          <EstimateCTA variant="outline" className="text-base">Photo Estimate — 60 Seconds <ArrowRight className="h-4 w-4" /></EstimateCTA>
        </div>
      </div>
    </section>
  </>
);

export default ${componentName};
`;
}

// ---------- GitHub helpers ----------

class GitHubAPI {
  constructor(private token: string) {}

  private async req(path: string, init: RequestInit = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "treecheck-dma",
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub ${init.method || "GET"} ${path} ${res.status}: ${body}`);
    }
    return res.json();
  }

  async getFile(path: string): Promise<{ content: string; sha: string } | null> {
    try {
      const data = await this.req(
        `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${REPO_BRANCH}`,
      );
      const decoded = atob(data.content.replace(/\n/g, ""));
      // GitHub returns base64 of UTF-8 bytes; decode bytes -> UTF-8
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
      const text = new TextDecoder().decode(bytes);
      return { content: text, sha: data.sha };
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes(" 404")) return null;
      throw e;
    }
  }

  async putTextFile(opts: {
    path: string;
    content: string;
    message: string;
    sha?: string;
  }) {
    const utf8 = new TextEncoder().encode(opts.content);
    let bin = "";
    for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
    const b64 = btoa(bin);
    const body: Record<string, unknown> = {
      message: opts.message,
      content: b64,
      branch: REPO_BRANCH,
    };
    if (opts.sha) body.sha = opts.sha;
    return this.req(
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(opts.path).replace(/%2F/g, "/")}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  }

  async putBinaryFile(opts: {
    path: string;
    bytes: Uint8Array;
    message: string;
    sha?: string;
  }) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < opts.bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(
        null,
        opts.bytes.subarray(i, i + chunk) as unknown as number[],
      );
    }
    const b64 = btoa(bin);
    const body: Record<string, unknown> = {
      message: opts.message,
      content: b64,
      branch: REPO_BRANCH,
    };
    if (opts.sha) body.sha = opts.sha;
    return this.req(
      `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(opts.path).replace(/%2F/g, "/")}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  }
}

// ---------- Patch helpers ----------

function patchAppTsx(source: string, project: GeneratedProject): string {
  const componentName = `Project${pascalCase(project.slug)}`;
  const importLine = `import ${componentName} from "./pages/projects/${componentName}";`;
  const routeLine = `              <Route path="/projects/${project.slug}/" element={<${componentName} />} />`;

  let out = source;

  // Add import after the last "./pages/" import
  if (!out.includes(importLine)) {
    const importRegex = /import\s+\w+\s+from\s+["']\.\/pages\/[^"']+["'];?\n/g;
    let lastIdx = -1;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(out)) !== null) {
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx > 0) {
      out = out.slice(0, lastIdx) + importLine + "\n" + out.slice(lastIdx);
    } else {
      throw new Error("Could not find pages import block in App.tsx");
    }
  }

  // Add route just before the catch-all "*" route
  if (!out.includes(routeLine)) {
    const catchAll = `<Route path="*" element={<NotFound />} />`;
    if (!out.includes(catchAll)) {
      throw new Error("Could not find catch-all route in App.tsx");
    }
    out = out.replace(catchAll, `${routeLine.trimStart()}\n              ${catchAll}`);
  }

  return out;
}

function patchFeaturedProjects(source: string, project: GeneratedProject, heroFilename: string): string {
  const importLine = `import ${pascalCase(project.slug)}Img from '@/assets/projects/${project.slug}/${heroFilename}';`;
  let out = source;

  if (!out.includes(importLine)) {
    // Add after the last "import ... from '@/assets/..." line
    const importRegex = /import\s+\w+\s+from\s+["']@\/assets\/[^"']+["'];?\n/g;
    let lastIdx = -1;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(out)) !== null) {
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx > 0) {
      out = out.slice(0, lastIdx) + importLine + "\n" + out.slice(lastIdx);
    } else {
      throw new Error("Could not find assets import block in FeaturedProjects.tsx");
    }
  }

  // Insert new entry at the TOP of the projects array
  const newEntry = `  {
    title: ${JSON.stringify(project.title.replace(/—/g, "—"))},
    slug: '/projects/${project.slug}/',
    image: ${pascalCase(project.slug)}Img,
    alt: ${JSON.stringify(project.heroAlt)},
    description: ${JSON.stringify(project.shortDescription)},
  },`;

  if (out.includes(`slug: '/projects/${project.slug}/'`)) {
    return out; // already present
  }

  const arrayStart = out.indexOf("const projects = [");
  if (arrayStart < 0) throw new Error("Could not find projects array in FeaturedProjects.tsx");
  const openBracket = out.indexOf("[", arrayStart);
  out = out.slice(0, openBracket + 1) + "\n" + newEntry + out.slice(openBracket + 1);

  return out;
}

function patchServicePage(source: string, project: GeneratedProject, heroFilename: string): string {
  // Inject a per-service "RECENT PROJECTS" block on the matched ServicePage.
  // The block renders as image preview cards linking to the full project page.

  let out = source;
  const projectImportName = `${pascalCase(project.slug)}RecentImg`;
  const importLine = `import ${projectImportName} from '@/assets/projects/${project.slug}/${heroFilename}';`;

  // 0) Add the project hero asset import (after last "@/assets/" import) if missing
  if (!out.includes(importLine)) {
    const importRegex = /import\s+\w+\s+from\s+["']@\/assets\/[^"']+["'];?\n/g;
    let lastIdx = -1;
    let m: RegExpExecArray | null;
    while ((m = importRegex.exec(out)) !== null) {
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx > 0) {
      out = out.slice(0, lastIdx) + importLine + "\n" + out.slice(lastIdx);
    }
  }

  // 1) Maintain a recentProjects record (insert if missing)
  const recentMarker = "// __DMA_RECENT_PROJECTS__";
  const mapType = "Record<string, { slug: string; title: string; image: string; description: string }[]>";

  if (!out.includes(recentMarker)) {
    const insertAfter = "const serviceContent: Record<string,";
    const idx = out.indexOf(insertAfter);
    if (idx < 0) throw new Error("Could not find serviceContent in ServicePage.tsx");
    const closeIdx = out.indexOf("\n};\n", idx);
    if (closeIdx < 0) throw new Error("Could not find serviceContent close in ServicePage.tsx");
    const insertPos = closeIdx + 4;

    const block = `\n${recentMarker}\nconst recentProjects: ${mapType} = {};\n`;
    out = out.slice(0, insertPos) + block + out.slice(insertPos);
  }

  // Migrate older { slug, title } shape to the new shape if needed.
  const oldShapeRegex = /const recentProjects: Record<string, \{ slug: string; title: string \}\[\]> = (\{[\s\S]*?\});\n/;
  const newShapeRegex = new RegExp(
    `const recentProjects: ${mapType.replace(/[{}\[\]]/g, (c) => "\\" + c)} = (\\{[\\s\\S]*?\\});\\n`,
  );

  let mapText: string | null = null;
  const newMatch = out.match(newShapeRegex);
  const oldMatch = !newMatch ? out.match(oldShapeRegex) : null;
  if (newMatch) {
    mapText = newMatch[1];
  } else if (oldMatch) {
    // Replace the old declaration with the new typed one and an empty/migrated map.
    // Old entries lack image refs; we drop them (they'll be rebuilt next publish).
    out = out.replace(oldShapeRegex, `const recentProjects: ${mapType} = {};\n`);
    mapText = "{}";
  }
  if (mapText === null) throw new Error("Could not find recentProjects map");

  // Parse map. Image refs are JS identifiers, not JSON, so we parse manually
  // by extracting per-category arrays via regex.
  type Entry = { slug: string; title: string; image: string; description: string };
  const parsed: Record<string, Entry[]> = {};

  // Find each "category": [ ... ] block
  const categoryRegex = /["']?([a-z-]+)["']?\s*:\s*\[([\s\S]*?)\]/g;
  let cm: RegExpExecArray | null;
  while ((cm = categoryRegex.exec(mapText)) !== null) {
    const cat = cm[1];
    const entriesText = cm[2];
    const entryRegex = /\{\s*slug:\s*["']([^"']+)["'],\s*title:\s*["']([^"']*)["'],\s*image:\s*([A-Za-z0-9_]+),\s*description:\s*["']([^"']*)["']\s*\}/g;
    const entries: Entry[] = [];
    let em: RegExpExecArray | null;
    while ((em = entryRegex.exec(entriesText)) !== null) {
      entries.push({ slug: em[1], title: em[2], image: em[3], description: em[4] });
    }
    parsed[cat] = entries;
  }

  const list = parsed[project.serviceCategory] || [];
  if (!list.find((x) => x.slug === project.slug)) {
    list.unshift({
      slug: project.slug,
      title: project.title,
      image: projectImportName,
      description: project.shortDescription,
    });
  }
  parsed[project.serviceCategory] = list.slice(0, 3); // keep latest 3

  // Serialize the map back. image is an identifier (no quotes); strings are JSON-escaped.
  const esc = (s: string) => JSON.stringify(s);
  const serialized =
    "{\n" +
    Object.entries(parsed)
      .map(([cat, entries]) => {
        const items = entries
          .map(
            (e) =>
              `    { slug: ${esc(e.slug)}, title: ${esc(e.title)}, image: ${e.image}, description: ${esc(e.description)} }`,
          )
          .join(",\n");
        return `  ${esc(cat)}: [\n${items}\n  ]`;
      })
      .join(",\n") +
    "\n}";

  out = out.replace(
    new RegExp(`const recentProjects: ${mapType.replace(/[{}\[\]]/g, (c) => "\\" + c)} = \\{[\\s\\S]*?\\};\\n`),
    `const recentProjects: ${mapType} = ${serialized};\n`,
  );

  // 2) Inject a "Recent Projects" rendered block (image preview cards) if not present
  const renderMarker = "{/* __DMA_RECENT_PROJECTS_RENDER__ */}";
  if (!out.includes(renderMarker)) {
    const lastFragmentClose = out.lastIndexOf("</>");
    if (lastFragmentClose < 0) return out;

    const renderBlock = `      ${renderMarker}
      {(recentProjects[slug as string] || []).length > 0 && (
        <section className="timber-section bg-muted">
          <div className="timber-container max-w-5xl">
            <h2 className="timber-heading-2 text-foreground mb-6">RECENT PROJECTS</h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {(recentProjects[slug as string] || []).map((rp) => (
                <Link
                  key={rp.slug}
                  to={\`/projects/\${rp.slug}/\`}
                  className="group block overflow-hidden rounded-xl bg-card shadow-md hover:shadow-xl transition-shadow"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-muted">
                    <img
                      src={rp.image}
                      alt={rp.title}
                      loading="lazy"
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <div className="p-4">
                    <h3 className="font-bold text-foreground mb-1.5 group-hover:text-primary transition-colors">{rp.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">{rp.description}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                      View project <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
`;
    out = out.slice(0, lastFragmentClose) + renderBlock + out.slice(lastFragmentClose);
  }

  return out;
}

// ---------- Main handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Set when a revision is in flight so failures can be surfaced on the post.
  let failCtx: { projectId: string; revisionId: string | null } | null = null;

  try {

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const GITHUB_PAT = Deno.env.get("GITHUB_PAT_TIMBER");

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    // GITHUB_PAT only required for Timber (GitHub-flow) contractors; validated later.

    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userResp, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userResp.user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userResp.user.id;

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: ownProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("dma_beta_enabled, full_name, company_name, parent_contractor_id")
      .eq("id", userId)
      .single();

    // Team members inherit DMA beta access from their parent contractor.
    let effectiveProfile = ownProfile;
    let effectiveContractorId = userId;
    if (ownProfile?.parent_contractor_id) {
      effectiveContractorId = ownProfile.parent_contractor_id;
      const { data: parentProfile } = await adminClient
        .from("profiles")
        .select("dma_beta_enabled, full_name, company_name, parent_contractor_id")
        .eq("id", ownProfile.parent_contractor_id)
        .single();
      if (parentProfile) effectiveProfile = parentProfile;
    }

    const { data: dmaAllowed, error: dmaPermissionError } = await userClient.rpc('company_has_permission', { p_owner: effectiveContractorId, p_permission: 'dmaManage' });
    if (dmaPermissionError || !dmaAllowed) return new Response(JSON.stringify({ error: 'Marketing publishing permission is required.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (profileErr || !effectiveProfile?.dma_beta_enabled) {
      return new Response(
        JSON.stringify({ error: "DMA beta access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Multi-tenant routing: some contractors publish via HTTPS webhook to their
    // own site instead of the Timber GitHub repo. Look up their integration.
    const { data: integrationRow } = await adminClient
      .from("dma_integrations")
      .select("website_url, brand_voice, site_provider, publish_endpoint_url, public_site_url")
      .eq("contractor_id", effectiveContractorId)
      .maybeSingle();

    // Per-contractor bearer secret map. Add new contractors here as they onboard.
    const CONTRACTOR_WEBHOOK_SECRETS: Record<string, string> = {
      "cae6f999-5dec-4498-8ac4-577485b7fbc5": "TREE_GIANTS_WEBHOOK_SECRET", // Tree Giants
      "5972f13f-7c5b-465d-9cc1-faef4cdbd4df": "ARBOR_IMAGE_WEBHOOK_SECRET", // The Arbor Image
    };
    // DMA Web (publishing to their site) is ONLY available when we built the site.
    // Otherwise fall back to postcard-only (skip web publish).
    const siteEligible = integrationRow?.site_provider === "first_impression";
    // The push target may be a backend function (preferred) or the site itself.
    const rawEndpoint = integrationRow?.publish_endpoint_url || integrationRow?.website_url;
    const webhookUrl = siteEligible && rawEndpoint && /^https:\/\//.test(rawEndpoint)
      ? rawEndpoint
      : null;
    // Public site origin used to build the finished page link.
    const publicSiteUrl = integrationRow?.public_site_url && /^https:\/\//.test(integrationRow.public_site_url)
      ? integrationRow.public_site_url
      : (integrationRow?.website_url && /^https:\/\//.test(integrationRow.website_url) ? integrationRow.website_url : null);
    const webhookSecretName = CONTRACTOR_WEBHOOK_SECRETS[effectiveContractorId];
    const useWebhook = !!(webhookUrl && webhookSecretName);


    // Tenant safety: the GitHub (timberedmond.com) publishing path is reserved for the
    // Timber account only. Any other contractor without their own configured webhook
    // must NOT be able to publish content onto someone else's website.
    const TIMBER_CONTRACTOR_IDS = new Set<string>([
      "cf93d0f4-9365-4352-b0cb-10ce93646843", // TimberII / mark@tradesmarketing.ai
      "705cecc2-5926-48c1-a728-b3ebd6b920a2", // Timber Edmond / mark@timberedmond.com (account owner)
    ]);
    // The event demo company (milestone 2) publishes too, but its posts never reach the site's files: see the demo
    // branch below.
    const isDemo = effectiveContractorId === DEMO_OWNER_ID;
    if (!useWebhook && !TIMBER_CONTRACTOR_IDS.has(effectiveContractorId) && !isDemo) {
      return new Response(
        JSON.stringify({
          error:
            "No website is connected to this account yet. Web publishing is disabled until your own site endpoint is configured.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }


    // --- Parse + validate body ---
    const body = (await req.json()) as PublishRequest;
    const isRevision = typeof body?.project_id === "string" && body.project_id.length > 0;

    const isRepublish = isRevision && body?.republish === true;

    let existingRow: Record<string, any> | null = null;
    let revisionId: string | null = null;
    let revisionInstruction = "";

    if (isRevision) {
      const { data: row } = await adminClient
        .from("dma_published_projects")
        .select("*")
        .eq("id", body.project_id!)
        .maybeSingle();
      if (!row) {
        return new Response(JSON.stringify({ error: "Published post not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.contractor_id !== effectiveContractorId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      existingRow = row;

      if (!isRepublish) {
        revisionInstruction = (body.transcript ?? "").trim();
        if (!revisionInstruction && body.voice_memo_path) {
          revisionInstruction = await transcribeMemo(adminClient, body.voice_memo_path, LOVABLE_API_KEY);
        }
        if (revisionInstruction.length < 3) {
          return new Response(JSON.stringify({ error: "We couldn't hear the memo — please record it again." }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Reuse the originally published photos unless new ones were supplied.
      body.photo_paths = (Array.isArray(body.photo_paths) && body.photo_paths.length
        ? body.photo_paths
        : (row.photo_paths as string[])) ?? [];
      if (body.photo_paths.length === 0) {
        return new Response(JSON.stringify({ error: "No photos on file for this post — add at least one." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!isRepublish) {
        const { data: revRow } = await adminClient
          .from("dma_project_revisions")
          .insert({
            project_id: row.id,
            contractor_id: effectiveContractorId,
            requested_by: userId,
            transcript: revisionInstruction,
            voice_memo_path: body.voice_memo_path ?? null,
            copy_before: row.copy,
            status: "pending",
          })
          .select("id")
          .single();
        revisionId = revRow?.id ?? null;
      }
      failCtx = { projectId: row.id as string, revisionId };

      await adminClient
        .from("dma_published_projects")
        .update({ status: "revising", last_error: null })
        .eq("id", row.id);
    } else {
      if (!body?.notes || typeof body.notes !== "string" || body.notes.trim().length < 5) {
        return new Response(JSON.stringify({ error: "notes is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!Array.isArray(body.photo_paths) || body.photo_paths.length === 0 || body.photo_paths.length > 4) {
        return new Response(JSON.stringify({ error: "1-4 photo_paths required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    // --- Resolve brand voice: prefer per-contractor DB value, else website repo (Timber) ---
    let brandVoiceFromRepo: string | null = null;
    let ghForBrand: GitHubAPI | null = null;
    if (integrationRow?.brand_voice && integrationRow.brand_voice.trim().length > 20) {
      brandVoiceFromRepo = integrationRow.brand_voice.trim();
      console.log(`[dma] using brand voice from dma_integrations (${brandVoiceFromRepo.length} chars)`);
    } else if (!useWebhook) {
      if (!GITHUB_PAT) throw new Error("GITHUB_PAT_TIMBER not configured");
      ghForBrand = new GitHubAPI(GITHUB_PAT);
      const brandVoicePaths = [
        ".lovable/memory/design/brand-voice.md",
        ".lovable/memory/style/brand-voice.md",
        ".lovable/memory/voice.md",
        "BRAND_VOICE.md",
        "docs/brand-voice.md",
        "src/content/brand-voice.md",
      ];
      for (const p of brandVoicePaths) {
        try {
          const f = await ghForBrand.getFile(p);
          if (f?.content && f.content.trim().length > 20) {
            brandVoiceFromRepo = f.content.trim();
            console.log(`[dma] using brand voice from repo: ${p} (${brandVoiceFromRepo.length} chars)`);
            break;
          }
        } catch (e) {
          console.warn(`[dma] could not fetch ${p}:`, (e as Error).message);
        }
      }
      if (!brandVoiceFromRepo) console.log("[dma] no brand voice doc found, using built-in fallback");
    }


    const effectiveSystemPrompt = brandVoiceFromRepo
      ? `${brandVoiceFromRepo}

---

${SYSTEM_PROMPT.replace(BRAND_VOICE, "").trim()}

IMPORTANT: The brand voice guidelines above are the canonical source of truth from the website's stored guidelines document. Adhere to them strictly when writing every word of copy.`
      : SYSTEM_PROMPT;

    // --- Download photos from storage, then normalize (never crop) ---
    // Long edge capped at 1600px, aspect ratio preserved, re-encoded as JPEG
    // with quality stepped down until each photo is under ~700 KB.
    const MAX_EDGE = 1600;
    const MAX_BYTES = 700_000;
    const photoBlobs: { bytes: Uint8Array; ext: string; contentType: string }[] = [];
    for (const path of body.photo_paths!) {
      const { data, error } = await adminClient.storage.from("lead-photos").download(path);
      if (error || !data) throw new Error(`Failed to download ${path}: ${error?.message}`);
      const ab = await data.arrayBuffer();
      const ext = (path.split(".").pop() || "jpg").toLowerCase();
      const contentType = data.type || (ext === "png" ? "image/png" : "image/jpeg");
      let bytes = new Uint8Array(ab);
      let outExt = ext;
      let outType = contentType;
      try {
        const { Image } = await import("https://deno.land/x/imagescript@1.2.17/mod.ts");
        const img = await Image.decode(bytes);
        const longEdge = Math.max(img.width, img.height);
        if (longEdge > MAX_EDGE) {
          // RESIZE_AUTO on the other axis keeps the aspect ratio (no cropping).
          if (img.width >= img.height) img.resize(MAX_EDGE, Image.RESIZE_AUTO);
          else img.resize(Image.RESIZE_AUTO, MAX_EDGE);
        }
        let encoded = await img.encodeJPEG(80);
        for (const q of [70, 60, 50]) {
          if (encoded.length <= MAX_BYTES) break;
          encoded = await img.encodeJPEG(q);
        }
        bytes = encoded;
        outExt = "jpg";
        outType = "image/jpeg";
        console.log("[dma] photo normalized", JSON.stringify({
          path,
          width: img.width,
          height: img.height,
          originalBytes: ab.byteLength,
          finalBytes: bytes.length,
        }));
      } catch (e) {
        console.warn("[dma] photo normalize failed, using original", path, String(e));
      }
      photoBlobs.push({ bytes, ext: outExt, contentType: outType });
    }


    // --- Call Lovable AI with images + notes (multimodal) ---
    const photoMessages = photoBlobs.map((p) => {
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < p.bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(
          null,
          p.bytes.subarray(i, i + chunk) as unknown as number[],
        );
      }
      const b64 = btoa(bin);
      return {
        type: "image_url" as const,
        image_url: { url: `data:${p.contentType};base64,${b64}` },
      };
    });

    const callAI = () => fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: effectiveSystemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: isRevision
                ? `You already published this featured project page. Here is the exact published content as JSON:\n\n${JSON.stringify(existingRow!.copy)}\n\nThe contractor recorded a casual voice memo asking for corrections. Transcript:\n\n"${revisionInstruction}"\n\nReturn the corrected project through the tool.\nRULES:\n- The contractor's correction is FACT. Apply it faithfully.\n- Change ONLY what they asked for, plus anything that is now factually inconsistent with their correction. Leave every other sentence byte-identical.\n- Keep the slug exactly "${existingRow!.slug}". Never change it.\n- Keep the same structure, section count, headings and tone.\n- Never invent details that were not stated. Never name or guess a tree species.\n- If they ask to remove something, remove it cleanly rather than rewording around it.`
                : `Contractor notes about this completed job:\n\n${body.notes}\n\nNumber of photos provided: ${photoBlobs.length}. Generate the featured project now.` },

              ...photoMessages,
            ],
          },
        ],
        tools: [GENERATOR_TOOL],
        tool_choice: { type: "function", function: { name: "generate_featured_project" } },
      }),
    });

    let project: GeneratedProject;

    if (isRepublish) {
      // Re-push the exact copy that is already stored — no AI, no new post.
      project = { ...(existingRow!.copy as GeneratedProject) };
      project.slug = existingRow!.slug as string;
    } else {
      let toolCall: any = null;
      let lastErr = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        const aiResp = await callAI();

        if (!aiResp.ok) {
          const t = await aiResp.text();
          if (aiResp.status === 429) {
            return new Response(JSON.stringify({ error: "AI rate limit hit, try again in a minute" }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (aiResp.status === 402) {
            return new Response(JSON.stringify({ error: "AI credits exhausted — top up Lovable AI" }), {
              status: 402,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          lastErr = `AI gateway ${aiResp.status}: ${t}`;
          console.warn(`[dma] AI attempt ${attempt} failed: ${lastErr}`);
          if (attempt === 3) throw new Error(lastErr);
          await new Promise((r) => setTimeout(r, attempt * 1500));
          continue;
        }

        const aiData = await aiResp.json();
        toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) break;

        lastErr = "AI did not return a tool call";
        console.warn(`[dma] AI attempt ${attempt}: no tool call`, JSON.stringify(aiData?.choices?.[0]?.message ?? aiData).slice(0, 500));
        if (attempt === 3) throw new Error(lastErr);
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }

      project = JSON.parse(toolCall.function.arguments);
    }

    // Sanity-clean slug
    project.slug = project.slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    if (!project.slug) project.slug = `project-${Date.now()}`;
    // A revision must never move the page: the slug is the identity of the live URL.
    if (isRevision) project.slug = existingRow!.slug as string;

    if (!SERVICE_SLUGS.includes(project.serviceCategory)) {
      project.serviceCategory = "tree-removal";
    }
    if (!project.seeAlsoServiceSlug || !SERVICE_SLUGS.includes(project.seeAlsoServiceSlug)) {
      project.seeAlsoServiceSlug = project.serviceCategory;
    }
    if (!project.seeAlsoAnchor || project.seeAlsoAnchor.trim().length < 4) {
      project.seeAlsoAnchor = `${project.serviceCategory.replace(/-/g, " ")} in Edmond and Oklahoma City`;
    }

    const photoFilenames = photoBlobs.map((p, i) => `${i === 0 ? "hero" : `photo-${i + 1}`}.${p.ext === "png" ? "png" : "jpg"}`);

    // --- Event demo (milestone 2): the post is served live by dma-live-posts for a few minutes and is never
    // committed to TimberEdmond.com's repository, so a demo can't touch Mark's real posts. This returns before
    // any GitHub or webhook write.
    if (isDemo) {
      const liveUrl = demoPostUrl(project.slug);
      // Clear the demo's own expired posts (their revisions first), so its post list stays short.
      const { data: expired } = await adminClient
        .from("dma_published_projects")
        .select("id")
        .eq("contractor_id", DEMO_OWNER_ID)
        .lt("published_at", liveSince(Date.now()));
      const expiredIds = ((expired ?? []) as { id: string }[]).map((r) => r.id).filter((id) => id !== existingRow?.id);
      if (expiredIds.length) {
        await adminClient.from("dma_project_revisions").delete().in("project_id", expiredIds);
        await adminClient.from("dma_published_projects").delete().eq("contractor_id", DEMO_OWNER_ID).in("id", expiredIds);
      }
      const { error: demoErr } = await adminClient
        .from("dma_published_projects")
        .upsert({
          contractor_id: DEMO_OWNER_ID,
          slug: project.slug,
          title: project.title,
          location: project.location || "Edmond, OK",
          service_category: project.serviceCategory,
          public_url: liveUrl,
          publish_endpoint_url: null,
          photo_paths: body.photo_paths,
          copy: project as unknown as Record<string, unknown>,
          status: "published",
          last_error: null,
          revision_count: isRevision ? ((existingRow!.revision_count as number) ?? 0) + (isRepublish ? 0 : 1) : 0,
          // Every save, a fix or a Regenerate included, restarts the post's live window.
          published_at: new Date().toISOString(),
        }, { onConflict: "contractor_id,slug" });
      if (demoErr) throw new Error(`Couldn't save the demo post: ${demoErr.message}`);
      if (revisionId) {
        await adminClient
          .from("dma_project_revisions")
          .update({ status: "applied", copy_after: project as unknown as Record<string, unknown> })
          .eq("id", revisionId);
      }
      failCtx = null;
      return new Response(
        JSON.stringify({
          success: true,
          slug: project.slug,
          url: liveUrl,
          previewUrl: liveUrl,
          title: project.title,
          serviceCategory: project.serviceCategory,
          shortDescription: project.shortDescription,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- BRANCH: webhook (multi-tenant) vs GitHub (Timber legacy) ---
    if (useWebhook) {
      const secretValue = Deno.env.get(webhookSecretName!);
      if (!secretValue) throw new Error(`${webhookSecretName} not configured`);

      // Photos were already resized (long edge <= 1600px, aspect preserved) and
      // JPEG-compressed above. Keep total base64 payload under ~4 MB — the
      // receiving serverless platform caps request bodies near 6 MB.
      const MAX_B64_TOTAL = 4_000_000;
      const toB64 = (bytes: Uint8Array) => {
        let bin = "";
        const chunk = 0x8000;
        for (let j = 0; j < bytes.length; j += chunk) {
          bin += String.fromCharCode.apply(null, bytes.subarray(j, j + chunk) as unknown as number[]);
        }
        return btoa(bin);
      };

      const photosPayload: { filename: string; base64: string; contentType: string; isCover: boolean }[] = [];
      let b64Total = 0;
      const droppedPhotos: string[] = [];
      for (let i = 0; i < photoBlobs.length; i++) {
        const p = photoBlobs[i];
        const filename = p.contentType === "image/jpeg"
          ? photoFilenames[i].replace(/\.[^.]+$/, ".jpg")
          : photoFilenames[i];
        const base64 = toB64(p.bytes);
        if (photosPayload.length > 0 && b64Total + base64.length > MAX_B64_TOTAL) {
          droppedPhotos.push(filename);
          continue;
        }
        b64Total += base64.length;
        photosPayload.push({ filename, base64, contentType: p.contentType, isCover: photosPayload.length === 0 });
      }

      console.log("[dma] photos packaged", JSON.stringify({
        count: photosPayload.length,
        b64Total,
        droppedPhotos,
      }));



      // Flat fields required by the Tree Giants /api/public/dma-inbound contract.
      const secText = (i: number) =>
        (project.sections?.[i]?.paragraphs ?? []).join("\n\n").trim();
      // Location comes from the job itself (the AI reads the city/neighborhood out of
      // the memo). Fallback is the contractor's OWN service area — never a hardcoded city.
      let location = (project.location ?? "").trim();
      if (!location) {
        const { data: areaRow } = await adminClient
          .from("service_areas")
          .select("city, region")
          .eq("contractor_id", effectiveContractorId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (areaRow?.city) {
          location = areaRow.region ? `${areaRow.city}, ${areaRow.region}` : areaRow.city;
        }
      }

      const webhookBody = {
        slug: project.slug,
        title: project.title,
        location,
        summary: project.shortDescription || project.intro,
        challenge: secText(0) || project.intro,
        approach: secText(1) || secText(0) || project.intro,
        result: secText(2) || secText(1) || project.shortDescription,
        seoTitle: project.seoTitle,
        metaDescription: project.metaDescription,
        shortDescription: project.shortDescription,
        intro: project.intro,
        heroAlt: project.heroAlt,
        photoAlts: project.photoAlts,
        // Sections are sent with several aliases for the body text so receivers
        // that read `body`/`text`/`content` (instead of `paragraphs`) still render
        // the copy under each heading.
        sections: (project.sections ?? []).map((sec) => {
          const paras = (sec.paragraphs ?? []).filter((p) => !!p && p.trim().length > 0);
          const joined = paras.join("\n\n");
          const html = [
            ...paras.map((p) => `<p>${p}</p>`),
            ...(sec.bullets?.length
              ? [`<ul>${sec.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`]
              : []),
          ].join("\n");
          return {
            heading: sec.heading,
            paragraphs: paras,
            bullets: sec.bullets ?? [],
            body: joined,
            text: joined,
            content: joined,
            html,
          };
        }),

        serviceCategory: project.serviceCategory,
        seeAlsoServiceSlug: project.seeAlsoServiceSlug,
        seeAlsoAnchor: project.seeAlsoAnchor,
        ctaHeadline: project.ctaHeadline,
        ctaSub: project.ctaSub,
        photos: photosPayload,
      };


      console.log("[dma] webhook payload shape", JSON.stringify({
        url: webhookUrl,
        slug: webhookBody.slug,
        lens: {
          title: webhookBody.title?.length ?? 0,
          location: webhookBody.location?.length ?? 0,
          summary: webhookBody.summary?.length ?? 0,
          challenge: webhookBody.challenge?.length ?? 0,
          approach: webhookBody.approach?.length ?? 0,
          result: webhookBody.result?.length ?? 0,
          ctaHeadline: webhookBody.ctaHeadline?.length ?? 0,
          ctaSub: webhookBody.ctaSub?.length ?? 0,
        },
        serviceCategory: webhookBody.serviceCategory,
        seeAlsoServiceSlug: webhookBody.seeAlsoServiceSlug,
        seeAlsoAnchor: webhookBody.seeAlsoAnchor,
        photos: photosPayload.map((p) => ({ filename: p.filename, contentType: p.contentType, isCover: p.isCover, b64len: p.base64.length })),
      }));

      const serializedBody = JSON.stringify(webhookBody);
      console.log("[dma] webhook body bytes", serializedBody.length);

      const whResp = await fetch(webhookUrl!, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretValue}`,
          "Content-Type": "application/json",
        },
        body: serializedBody,
      });
      const whText = await whResp.text();
      const whErrHeader = whResp.headers.get("x-dma-error");
      if (!whResp.ok) {
        console.error("[dma] webhook failed", JSON.stringify({
          status: whResp.status,
          xDmaError: whErrHeader,
          bodyLen: whText.length,
          body: whText.slice(0, 500),
          sentBytes: serializedBody.length,
        }));
        throw new Error(`Website webhook ${whResp.status}: ${whErrHeader || whText || "(empty body)"}`);
      }

      let whJson: { ok?: boolean; url?: string } = {};
      try { whJson = JSON.parse(whText); } catch { /* not json, that's ok */ }

      const finalUrl = whJson.url ?? `${new URL(publicSiteUrl ?? webhookUrl!).origin}/featured-jobs/${project.slug}`;

      // Record the published post so it shows in the app and can be revised later.
      const { error: recErr } = await adminClient
        .from("dma_published_projects")
        .upsert({
          contractor_id: effectiveContractorId,
          slug: project.slug,
          title: project.title,
          location,
          service_category: project.serviceCategory,
          public_url: finalUrl,
          publish_endpoint_url: webhookUrl,
          photo_paths: body.photo_paths,
          copy: project as unknown as Record<string, unknown>,
          status: "published",
          last_error: null,
          revision_count: isRevision ? ((existingRow!.revision_count as number) ?? 0) + (isRepublish ? 0 : 1) : 0,
          published_at: isRevision ? existingRow!.published_at : new Date().toISOString(),
        }, { onConflict: "contractor_id,slug" });
      if (recErr) console.error("[dma] failed to record published project", recErr.message);
      if (revisionId) {
        await adminClient
          .from("dma_project_revisions")
          .update({ status: "applied", copy_after: project as unknown as Record<string, unknown> })
          .eq("id", revisionId);
      }
      failCtx = null;


      return new Response(
        JSON.stringify({
          success: true,
          slug: project.slug,
          url: finalUrl,
          title: project.title,
          serviceCategory: project.serviceCategory,
          shortDescription: project.shortDescription,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    }

    // --- GitHub commits (Timber default) ---
    if (!GITHUB_PAT) throw new Error("GITHUB_PAT_TIMBER not configured");
    const gh = ghForBrand ?? new GitHubAPI(GITHUB_PAT);

    // 1. Upload photos (fetch existing sha to allow overwrite if slug already exists)
    for (let i = 0; i < photoBlobs.length; i++) {
      const photoPath = `src/assets/projects/${project.slug}/${photoFilenames[i]}`;
      const existing = await gh.getFile(photoPath).catch(() => null);
      await gh.putBinaryFile({
        path: photoPath,
        bytes: photoBlobs[i].bytes,
        message: `chore(dma): add photo ${i + 1} for ${project.slug}`,
        sha: existing?.sha,
      });
    }

    // 2. Create the project page
    const tsx = buildProjectTsx(project, photoFilenames);
    const componentName = `Project${pascalCase(project.slug)}`;
    await gh.putTextFile({
      path: `src/pages/projects/${componentName}.tsx`,
      content: tsx,
      message: `feat(dma): add featured project ${project.slug}`,
    });

    // 3. Patch App.tsx
    const appFile = await gh.getFile("src/App.tsx");
    if (!appFile) throw new Error("App.tsx not found in repo");
    const newApp = patchAppTsx(appFile.content, project);
    if (newApp !== appFile.content) {
      await gh.putTextFile({
        path: "src/App.tsx",
        content: newApp,
        sha: appFile.sha,
        message: `feat(dma): wire route for ${project.slug}`,
      });
    }

    // 4. Patch FeaturedProjects.tsx
    const fpFile = await gh.getFile("src/pages/FeaturedProjects.tsx");
    if (!fpFile) throw new Error("FeaturedProjects.tsx not found");
    const newFp = patchFeaturedProjects(fpFile.content, project, photoFilenames[0]);
    if (newFp !== fpFile.content) {
      await gh.putTextFile({
        path: "src/pages/FeaturedProjects.tsx",
        content: newFp,
        sha: fpFile.sha,
        message: `feat(dma): list ${project.slug} on Featured Projects`,
      });
    }

    // 5. Patch ServicePage.tsx (recent projects link under matched service)
    try {
      const spFile = await gh.getFile("src/pages/ServicePage.tsx");
      if (spFile) {
        const newSp = patchServicePage(spFile.content, project, photoFilenames[0]);
        if (newSp !== spFile.content) {
          await gh.putTextFile({
            path: "src/pages/ServicePage.tsx",
            content: newSp,
            sha: spFile.sha,
            message: `feat(dma): link ${project.slug} from ${project.serviceCategory} page`,
          });
        }
      }
    } catch (e) {
      console.error("ServicePage patch failed:", (e as Error).message);
    }

    {
      const { error: recErr } = await adminClient
        .from("dma_published_projects")
        .upsert({
          contractor_id: effectiveContractorId,
          slug: project.slug,
          title: project.title,
          location: "Edmond, OK",
          service_category: project.serviceCategory,
          public_url: `https://timberedmond.com/projects/${project.slug}/`,
          publish_endpoint_url: null,
          photo_paths: body.photo_paths,
          copy: project as unknown as Record<string, unknown>,
          status: "published",
          last_error: null,
          revision_count: isRevision ? ((existingRow!.revision_count as number) ?? 0) + (isRepublish ? 0 : 1) : 0,
          published_at: isRevision ? existingRow!.published_at : new Date().toISOString(),
        }, { onConflict: "contractor_id,slug" });
      if (recErr) console.error("[dma] failed to record published project", recErr.message);
      if (revisionId) {
        await adminClient
          .from("dma_project_revisions")
          .update({ status: "applied", copy_after: project as unknown as Record<string, unknown> })
          .eq("id", revisionId);
      }
      failCtx = null;
    }

    return new Response(
      JSON.stringify({
        success: true,
        slug: project.slug,
        url: `https://timberedmond.com/projects/${project.slug}/`,
        previewUrl: `https://timber-roots-ai.lovable.app/projects/${project.slug}/`,
        title: project.title,
        serviceCategory: project.serviceCategory,
        shortDescription: project.shortDescription,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );


  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("dma-publish-project error:", msg);
    if (failCtx) {
      try {
        const failClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await failClient
          .from("dma_published_projects")
          .update({ status: "failed", last_error: msg.slice(0, 500) })
          .eq("id", failCtx.projectId);
        if (failCtx.revisionId) {
          await failClient
            .from("dma_project_revisions")
            .update({ status: "failed", error: msg.slice(0, 500) })
            .eq("id", failCtx.revisionId);
        }
      } catch (e2) {
        console.error("[dma] could not mark revision failed", String(e2));
      }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  }
});
