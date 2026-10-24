// Scout learning (the weekly feedback loop, App Improvements milestone 4): the pure helpers shared by the hooks
// in scout-submit, scout-retry-estimate, scout-estimate-callback and create-personal-lead, and by
// scout-learning-run. No Deno, fetch, database or clock here, so the vitest suite covers it directly.
// Maintained outside Lovable.

export type Surface = "scout" | "website";

/** How much of the rep's notes a Scout snapshot keeps. */
export const SCOUT_NOTES_MAX = 1000;
/** How much of an estimator's answer (Scout's notes, the website's email text) a snapshot keeps. */
export const RESULT_NOTES_MAX = 4000;
/** A guidance block's longest length; the database checks the same limit on scout_learning_runs.block. */
export const GUIDANCE_MAX = 1500;
/** Fields the website workflow adds for learning; create-personal-lead's stump scan must never see them. */
export const LEARNING_FIELDS = ["ai_notes", "form_inputs", "learning_version"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** A positive number from a number or a numeric string, else null (blank, zero, NaN and text all count as missing). */
export function positiveNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Trimmed text cut to `max` characters, or null when there is none. */
export function capText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** What Scout was given for one capture, as the loop needs it later. */
export interface ScoutInputs {
  service: string | null;
  diameter_in: number | null;
  circumference_in: number | null;
  /** True when a diameter or circumference was given (Scout otherwise prices from the photo alone). */
  size_given: boolean;
  notes_given: boolean;
  notes: string | null;
  photos: number;
  voice_memo: boolean;
}

export function scoutInputs(raw: {
  service?: unknown; diameterInches?: unknown; circumferenceInches?: unknown; notes?: unknown;
  photoCount?: unknown; voiceMemo?: unknown;
}): ScoutInputs {
  const diameter = positiveNumber(raw.diameterInches);
  const circumference = positiveNumber(raw.circumferenceInches);
  const notes = capText(raw.notes, SCOUT_NOTES_MAX);
  const photos = typeof raw.photoCount === "number" && Number.isInteger(raw.photoCount) && raw.photoCount > 0
    ? raw.photoCount : 0;
  return {
    service: typeof raw.service === "string" && raw.service.trim() ? raw.service.trim().slice(0, 40) : null,
    diameter_in: diameter,
    circumference_in: circumference,
    size_given: diameter !== null || circumference !== null,
    notes_given: notes !== null,
    notes,
    photos,
    voice_memo: raw.voiceMemo === true,
  };
}

// The website form's inputs worth keeping: sizes, whether there was a photo or notes. Anything else (names,
// addresses, phones, emails, free text) is dropped, so a snapshot never holds a customer's details.
const FORM_KEYS: Record<string, string> = {
  trunkdiameter: "trunk_diameter",
  trunk_diameter: "trunk_diameter",
  treeheight: "tree_height",
  tree_height: "tree_height",
  stumpdiameter: "stump_diameter",
  stump_diameter: "stump_diameter",
  has_photo: "has_photo",
  hasphoto: "has_photo",
  notes_given: "notes_given",
  notesgiven: "notes_given",
};

export function websiteFormInputs(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = FORM_KEYS[k.toLowerCase()];
    if (!key || key in out) continue;
    if (typeof v === "boolean") out[key] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "string" && v.trim() && v.trim().length <= 40) out[key] = v.trim();
  }
  return out;
}

/** The website payload without the learning fields, for create-personal-lead's stump scan. */
export function withoutLearningFields<T extends Record<string, unknown>>(payload: T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...payload };
  for (const f of LEARNING_FIELDS) delete copy[f];
  return copy;
}

/** A guidance block safe to send to an estimator: trimmed text up to GUIDANCE_MAX, or "" for none. */
export function guidanceOrEmpty(block: unknown): string {
  return typeof block === "string" ? block.trim().slice(0, GUIDANCE_MAX) : "";
}
