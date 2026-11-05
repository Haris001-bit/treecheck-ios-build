// The answers live Scout (the n8n webhook) gives for each tree detail, in Scout's own words, and what each one
// means for the Production Engine. Calibration dropdowns show exactly these, so the owner picks from the same
// choices Scout picks from. Only the answer names live here: never the Scout prompt, its rates or percentages.
// Pure (no imports), shared by the server (calibrationWebhook.ts) and the calibration screen.

export type ScoutChoiceKey =
  | 'canopy_dense' | 'multiple_leaders' | 'condition' | 'near_structure' | 'access' | 'drop_zone' | 'crane_indicated' | 'loads';

export type ScoutChoice = { label: string; value: unknown };
export type ScoutChoiceSet = { label: string; choices: ScoutChoice[]; read: (text: string) => string | null };

const t = (s: string) => s.toLowerCase().trim();

export const SCOUT_CHOICES: Record<ScoutChoiceKey, ScoutChoiceSet> = {
  canopy_dense: {
    label: 'Canopy density',
    choices: [{ label: 'Full', value: true }, { label: 'Moderate', value: false }, { label: 'Minimal', value: false }],
    read: (s) => {
      const x = t(s);
      if (/^full|dense|heavy|thick/.test(x)) return 'Full';
      if (/^moderate|medium|partial/.test(x)) return 'Moderate';
      if (/^minimal|sparse|light|thin|bare|none|leafless|no leaves/.test(x)) return 'Minimal';
      return null;
    },
  },
  multiple_leaders: {
    label: 'Crown structure',
    choices: [
      { label: 'Single leader or V-split above ~12 ft', value: false },
      { label: '2 leaders, union ~6–12 ft', value: true },
      { label: '3 leaders or union ~3–6 ft', value: true },
      { label: '4+ leaders or union at/below ~3 ft', value: true },
    ],
    read: (s) => {
      const x = t(s);
      const n = x.match(/(\d+)\s*\+?\s*(?:co-?dominant\s+)?(?:leaders?|stems?|trunks?)/);
      if (n) {
        const k = Number(n[1]);
        return k <= 1 ? 'Single leader or V-split above ~12 ft' : k === 2 ? '2 leaders, union ~6–12 ft' : k === 3 ? '3 leaders or union ~3–6 ft' : '4+ leaders or union at/below ~3 ft';
      }
      if (/multi-?stem/.test(x)) return '4+ leaders or union at/below ~3 ft';
      if (/single|one leader|central leader|v-split/.test(x)) return 'Single leader or V-split above ~12 ft';
      return null;
    },
  },
  condition: {
    label: 'Condition',
    choices: [{ label: 'Healthy', value: 'healthy' }, { label: 'Ailing', value: 'declining' }, { label: 'Diseased/Damaged/Dead', value: 'dead' }],
    read: (s) => {
      const x = t(s);
      if (/dead|diseas|damag|decay|rot/.test(x)) return 'Diseased/Damaged/Dead';
      if (/ail|declin|stress|fair|poor|dying/.test(x)) return 'Ailing';
      if (/healthy|good/.test(x)) return 'Healthy';
      return null;
    },
  },
  near_structure: {
    label: 'Proximity to structures',
    choices: [
      { label: 'House/Shed', value: true }, { label: 'Driveway/Fence', value: true },
      { label: 'Other Trees', value: false }, { label: 'Clear', value: false },
    ],
    read: (s) => {
      const x = t(s);
      if (/house|shed|deck|garage|building|home|roof|structure/.test(x) && !/^(clear|none|no )/.test(x)) return 'House/Shed';
      if (/driveway|fence|sidewalk|patio|road|street/.test(x)) return 'Driveway/Fence';
      if (/other trees|trees/.test(x)) return 'Other Trees';
      if (/^(clear|none|no|far|open)/.test(x)) return 'Clear';
      return null;
    },
  },
  access: {
    label: 'Accessibility',
    choices: [
      { label: 'Clear', value: 'easy' }, { label: 'Minor obstructions', value: 'moderate' },
      { label: 'Fence', value: 'tight' }, { label: 'Other/heavy obstructions', value: 'tight' },
    ],
    read: (s) => {
      const x = t(s);
      if (/^minor/.test(x)) return 'Minor obstructions';
      if (/^fence|^gate/.test(x)) return 'Fence';
      if (/^(other|heavy|major)/.test(x)) return 'Other/heavy obstructions';
      if (/^(clear|easy|open)/.test(x)) return 'Clear';
      if (/heavy|major|difficult|no access/.test(x)) return 'Other/heavy obstructions';
      if (/minor|some|limited|moderate/.test(x)) return 'Minor obstructions';
      if (/fence|gate/.test(x)) return 'Fence';
      return null;
    },
  },
  drop_zone: {
    label: 'Clear drop zone',
    choices: [{ label: 'Yes', value: 'open' }, { label: 'No', value: 'restricted' }],
    read: (s) => /^\s*yes/i.test(s) ? 'Yes' : /^\s*no/i.test(s) ? 'No' : null,
  },
  crane_indicated: {
    label: 'Crane required',
    choices: [{ label: 'Yes', value: true }, { label: 'No', value: false }],
    read: (s) => /^\s*yes/i.test(s) ? 'Yes' : /^\s*no/i.test(s) ? 'No' : null,
  },
  loads: {
    label: 'Disposal',
    choices: [{ label: 'No haul-off', value: 0 }, { label: '1 load', value: 1 }, { label: '2 loads', value: 2 }, { label: '3+ loads', value: 3 }],
    read: (s) => {
      const x = t(s);
      const n = x.match(/(\d+)\s*\+?/);
      if (n) { const k = Number(n[1]); return k <= 0 ? 'No haul-off' : k === 1 ? '1 load' : k === 2 ? '2 loads' : '3+ loads'; }
      if (/^(none|no)/.test(x)) return 'No haul-off';
      return null;
    },
  },
};

/** Scout's answer name for a detail, from the text after its label in Scout's notes. */
export function readScoutChoice(key: ScoutChoiceKey, text: string | null | undefined): ScoutChoice | null {
  if (!text) return null;
  const set = SCOUT_CHOICES[key];
  const label = set.read(text);
  return label ? set.choices.find((c) => c.label === label) ?? null : null;
}

/** Where each detail sits in Scout's notes ("Canopy density: Minimal"). */
export const SCOUT_NOTE_LABELS: Record<ScoutChoiceKey, RegExp[]> = {
  canopy_dense: [/canopy/],
  multiple_leaders: [/crown|leader|stem/],
  condition: [/condition|health/],
  near_structure: [/proximity|structures|house|building/],
  access: [/access/],
  drop_zone: [/drop zone/],
  crane_indicated: [/crane/],
  loads: [/disposal|debris|load|haul/],
};
