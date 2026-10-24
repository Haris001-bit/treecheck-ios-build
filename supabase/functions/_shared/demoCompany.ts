// The event demo company (milestone 2, Mark's booth on 2026-11-11 to 2026-11-14): its owner and climber logins,
// the one-tap switch between them, and the website posts it publishes. Both logins are sandbox companies
// (profiles.is_sandbox), set up by docs/demo/demo_setup.sql. Pure, so vitest can check it.
// Maintained outside Lovable.

export const DEMO_OWNER_ID = "914561d0-fba3-4b90-97b7-673ed8e8b458";
export const DEMO_CLIMBER_ID = "4de5dd88-5c08-4732-b108-64cd62d626a2";

/** How long a demo website post stays live after it is published. */
export const LIVE_POST_MINUTES = 5;

/** The page TimberEdmond.com shows a live demo post on (it reads the post from dma-live-posts). */
export const demoPostUrl = (slug: string) => `https://timberedmond.com/projects/live/${encodeURIComponent(slug)}`;

/** The other demo login and the screen it opens on, or null when the caller isn't one of the pair. */
export function otherDemoLogin(userId: string): { id: string; open: string } | null {
  if (userId === DEMO_OWNER_ID) return { id: DEMO_CLIMBER_ID, open: "/dashboard/crew-bids" };
  if (userId === DEMO_CLIMBER_ID) return { id: DEMO_OWNER_ID, open: "/dashboard/bid-board" };
  return null;
}

/** The earliest publish time that is still live at nowMs, as an ISO string. */
export function liveSince(nowMs: number): string {
  return new Date(nowMs - LIVE_POST_MINUTES * 60_000).toISOString();
}

/** What the website gets for a live demo post: the post's own text and photos, nothing else. */
export interface PublicPost {
  slug: string;
  title: string;
  shortDescription: string;
  seoTitle: string;
  metaDescription: string;
  location: string;
  intro: string;
  sections: {
    heading: string;
    paragraphs: string[];
    bullets: string[];
    recommendations: { label: string; description: string }[];
  }[];
  whyChoicesHeading: string;
  whyChoices: string[];
  ctaHeadline: string;
  ctaSub: string;
  heroAlt: string;
  photos: { url: string; alt: string }[];
  publishedAt: string;
  expiresAt: string;
}

const text = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");
const texts = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, 2000)) : [];
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** A demo post's public fields, from the generated copy stored in dma_published_projects.copy. */
export function publicPost(slug: string, copy: unknown, photoUrls: string[], publishedAt: string): PublicPost {
  const c = record(copy);
  const alts = texts(c.photoAlts);
  const sections = (Array.isArray(c.sections) ? c.sections : []).slice(0, 12).map((s) => {
    const x = record(s);
    return {
      heading: text(x.heading, 300),
      paragraphs: texts(x.paragraphs),
      bullets: texts(x.bullets),
      recommendations: (Array.isArray(x.recommendations) ? x.recommendations : []).slice(0, 12).map((r) => {
        const y = record(r);
        return { label: text(y.label, 200), description: text(y.description, 1000) };
      }),
    };
  });
  const published = Date.parse(publishedAt);
  return {
    slug,
    title: text(c.title, 300),
    shortDescription: text(c.shortDescription, 600),
    seoTitle: text(c.seoTitle, 300),
    metaDescription: text(c.metaDescription, 600),
    location: text(c.location, 200),
    intro: text(c.intro),
    sections,
    whyChoicesHeading: text(c.whyChoicesHeading, 300),
    whyChoices: texts(c.whyChoices),
    ctaHeadline: text(c.ctaHeadline, 300),
    ctaSub: text(c.ctaSub, 600),
    heroAlt: text(c.heroAlt, 300),
    photos: photoUrls.map((url, i) => ({ url, alt: alts[i] ?? text(c.heroAlt, 300) })),
    publishedAt,
    expiresAt: new Date((Number.isFinite(published) ? published : 0) + LIVE_POST_MINUTES * 60_000).toISOString(),
  };
}
