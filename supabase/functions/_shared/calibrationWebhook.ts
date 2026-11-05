// Calibration photos go through the Scout webhook (n8n), the same AI that prices live Scout jobs, and every
// calibration detail comes from its answer. The answer arrives as notes text, e.g.
// "OBSERVATIONS - Estimated DBH: Approximately 13-24 inches - Estimated height: Approximately 40-60 feet -
//  Canopy density: Full - Crown structure: 2 co-dominant leaders - Condition: Healthy - Proximity to structures:
//  Close to house/shed - Accessibility: Clear - Disposal: 1 load - Crane required: No - Clear drop zone: No
//  PRICE BREAKDOWN ... PRICING NOTES ..."
// This file turns that text into the calibration fields. It never keeps the price or the price breakdown,
// because a selling price must not drive crew/hour predictions (src/lib/production/AGENTS.md).

import { readScoutChoice, SCOUT_NOTE_LABELS, type ScoutChoiceKey } from './scoutChoices.ts';

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
/** `label` is Scout's own answer name ("Minimal", "Minor obstructions") when the detail is one of Scout's choices. */
export type Field<T> = { value: T | null; confidence: Confidence; label?: string };
export type ReadNumber = Field<number> & { low?: number; high?: number; text?: string };
export type Characteristics = {
  dbh_inches: ReadNumber; height_ft: ReadNumber; canopy_dense: Field<boolean>; multiple_leaders: Field<boolean>;
  condition: Field<'healthy' | 'declining' | 'dead'>; near_structure: Field<boolean>;
  access: Field<'easy' | 'moderate' | 'tight'>; drop_zone: Field<'open' | 'restricted'>; power_lines: Field<boolean>;
  crane_indicated: Field<boolean>; loads: ReadNumber; tree_count: ReadNumber; observations: string[];
};
export type WebhookReading = {
  characteristics: Characteristics;
  dbh_inches: ReadNumber; height_ft: ReadNumber;
  notes: string | null; difficulty: string | null; risk: string | null; received_at: string;
};
export const WEBHOOK_MODEL = 'scout-webhook (n8n scout-tree-automation)';

const UNKNOWN = { value: null, confidence: 'unknown' as const };
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const RANGE = String.raw`${NUM}(?:\s*(?:-|–|—|to)\s*${NUM})?\s*(\+)?`;

/** The OBSERVATIONS part only: the price breakdown and pricing notes are dropped. */
export function observationsPart(notes: string): string {
  const cut = notes.search(/PRICE BREAKDOWN|PRICING NOTES/i);
  return (cut >= 0 ? notes.slice(0, cut) : notes).replace(/^\s*OBSERVATIONS\s*/i, '').trim();
}

/** "Label: value" pairs from "- Label: value - Label: value". */
export function labelled(obs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of obs.split(/\s+-\s+|\n|^-\s*/)) {
    const m = part.match(/^\s*-?\s*([A-Za-z][A-Za-z /()]+?)\s*:\s*(.+?)\s*$/);
    if (m) out[m[1].toLowerCase().replace(/\s+/g, ' ').trim()] = m[2].trim();
  }
  return out;
}

const pick = (pairs: Record<string, string>, ...keys: RegExp[]) => {
  for (const [k, v] of Object.entries(pairs)) if (keys.some((re) => re.test(k))) return v;
  return null;
};

function readRange(text: string | null, limits: { min: number; max: number }): ReadNumber {
  if (!text) return { ...UNKNOWN };
  const m = text.match(new RegExp(RANGE));
  if (!m) return { ...UNKNOWN };
  const low = Number(m[1]);
  const high = m[2] != null ? Number(m[2]) : low;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return { ...UNKNOWN };
  const [a, b] = low <= high ? [low, high] : [high, low];
  const value = Math.min(limits.max, Math.max(limits.min, Math.round((a + b) / 2)));
  const span = b - a;
  const confidence: Confidence = span <= Math.max(6, a * 0.35) ? 'medium' : 'low';
  return { value, confidence, low: a, high: b, text: text.trim() };
}

const yesNo = (v: string | null): Field<boolean> => {
  if (!v) return { ...UNKNOWN };
  if (/^\s*(yes|y|true|present|likely)\b/i.test(v)) return { value: true, confidence: 'medium' };
  if (/^\s*(no|n|none|false|not)\b/i.test(v)) return { value: false, confidence: 'medium' };
  return { ...UNKNOWN };
};

export function parseScoutNotes(notes: string | null | undefined): Characteristics {
  const obs = observationsPart(String(notes ?? ''));
  const p = labelled(obs);
  const dbh = readRange(pick(p, /dbh/, /trunk diameter/, /^diameter/), { min: 1, max: 200 });
  const height = readRange(pick(p, /height/), { min: 5, max: 300 });

  // Each detail reads as one of Scout's own answers (scoutChoices.ts); the answer name is kept as `label`.
  const choice = <T,>(key: ScoutChoiceKey): Field<T> => {
    const c = readScoutChoice(key, pick(p, ...SCOUT_NOTE_LABELS[key]));
    return c ? { value: c.value as T, confidence: 'medium', label: c.label } : { ...UNKNOWN };
  };
  const canopy = choice<boolean>('canopy_dense');
  const leaders = choice<boolean>('multiple_leaders');
  const condition = choice<'healthy' | 'declining' | 'dead'>('condition');
  const nearStructure = choice<boolean>('near_structure');
  const access = choice<'easy' | 'moderate' | 'tight'>('access');
  const dropZone = choice<'open' | 'restricted'>('drop_zone');
  const crane = choice<boolean>('crane_indicated');

  const loadsText = pick(p, ...SCOUT_NOTE_LABELS.loads);
  const loadsRead = readRange(loadsText, { min: 0, max: 50 });
  const loadsChoice = readScoutChoice('loads', loadsText);
  const loads: ReadNumber = loadsRead.value == null ? loadsRead : { ...loadsRead, confidence: 'medium', label: loadsChoice?.label };
  const countRead = readRange(pick(p, /tree count|number of trees|trees/), { min: 1, max: 50 });
  // Scout reads one tree per submission; when it gives one tree's trunk size and no count, that's one tree.
  const treeCount: ReadNumber = countRead.value == null && dbh.value != null
    ? { ...countRead, value: 1, confidence: 'medium' }
    : countRead;

  return {
    dbh_inches: dbh, height_ft: height, canopy_dense: canopy, multiple_leaders: leaders, condition,
    near_structure: nearStructure, access, drop_zone: dropZone,
    power_lines: yesNo(pick(p, /power|utility|wire|line/)),
    crane_indicated: crane,
    loads,
    tree_count: treeCount,
    observations: Object.entries(p).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)}: ${v}`).filter((s) => !/\$/.test(s)).slice(0, 12),
  };
}

const SPECIES = /\b(oak|maple|pine|conifer|deciduous|evergreen|spruce|fir|cedar|elm|ash|birch|willow|cottonwood|sycamore|magnolia|cypress|redwood|sequoia|hickory|walnut|pecan|poplar|aspen|juniper|hemlock|locust|mulberry|dogwood|cherry|plum|apple|pear|palm|holly|beech|chestnut|catalpa|gum|sweetgum|bradford\s*pear|crape\s*myrtle|crepe\s*myrtle|bald\s*cypress|live\s*oak|red\s*oak|white\s*oak)\b/gi;
const clean = (t: unknown) => {
  const s = String(t ?? '').replace(SPECIES, 'tree').replace(/\s+/g, ' ').trim();
  return s || null;
};

export function buildWebhookReading(body: Record<string, unknown>, now = new Date()): WebhookReading {
  const full = clean(body?.notes);
  const characteristics = parseScoutNotes(full);
  const notes = full ? observationsPart(full).slice(0, 4000) || null : null; // no price, no price breakdown
  return {
    characteristics,
    dbh_inches: characteristics.dbh_inches,
    height_ft: characteristics.height_ft,
    notes,
    difficulty: body?.difficulty != null ? String(body.difficulty).slice(0, 200) : null,
    risk: body?.risk != null ? String(body.risk).slice(0, 200) : null,
    received_at: now.toISOString(),
  };
}

/** Saves the webhook's reading as the calibration's AI reading. Returns false when the id is not a calibration. Never texts anyone. */
// deno-lint-ignore no-explicit-any
export async function storeCalibrationReading(admin: any, id: string, body: Record<string, unknown>): Promise<boolean> {
  const { data: row, error: readErr } = await admin.from('production_calibrations').select('id, webhook_reading').eq('id', id).maybeSingle();
  if (readErr || !row) return false;
  if (row.webhook_reading) return true; // first answer wins; the table locks it anyway
  const reading = buildWebhookReading(body);
  const { error } = await admin.from('production_calibrations')
    .update({ webhook_reading: reading, ai_characteristics: reading.characteristics, ai_model: WEBHOOK_MODEL })
    .eq('id', id);
  if (error) throw new Error(error.message);
  return true;
}
