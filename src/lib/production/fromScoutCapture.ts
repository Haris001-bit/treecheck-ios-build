import type { JobCharacteristics, Rigging } from './engine';

/**
 * Maps a Scout capture into engine inputs. Uses tree/job characteristics only.
 * wk_ground_crew and wk_hours (climber/sub inputs) are intentionally ignored.
 */
export function fromScoutCapture(c: any): JobCharacteristics {
  const job: JobCharacteristics = { service: c.final_service || c.ai_service || c.requested_service || null };
  const text = [c.ai_notes, c.notes_summary, c.final_notes, c.notes_raw].filter(Boolean).join(' \n ').toLowerCase();
  const has = (re: RegExp) => re.test(text);

  if (Number(c.diameter_inches) > 0) job.dbhInches = { value: Number(c.diameter_inches), source: 'known' };
  else if (Number(c.circumference_inches) > 0) job.dbhInches = { value: Number(c.circumference_inches) / Math.PI, source: 'known' };
  else {
    const m = text.match(/(\d{1,3})\s*(?:"|in\b|inch|inches)\s*(?:dbh|diameter|trunk)?/);
    if (m && Number(m[1]) >= 4 && Number(m[1]) <= 120) job.dbhInches = { value: Number(m[1]), source: 'inferred' };
  }

  const h = text.match(/(\d{2,3})\s*(?:-|–|to)?\s*(\d{2,3})?\s*(?:ft|feet|foot|')\b/);
  if (h) {
    const a = Number(h[1]); const b = h[2] ? Number(h[2]) : a;
    const v = (a + b) / 2;
    if (v >= 10 && v <= 150) job.heightFt = { value: v, source: 'inferred' };
  }

  if (has(/dense|thick canopy|full canopy/)) job.canopyDense = { value: true, source: 'inferred' };
  if (has(/multiple leaders|multi-?stem|co-?dominant|several leaders/)) job.multipleLeaders = { value: true, source: 'inferred' };
  if (has(/\bdead\b|hazard/)) job.condition = { value: 'dead', source: 'inferred' };
  else if (has(/declin|decay|rot/)) job.condition = { value: 'declining', source: 'inferred' };
  if (has(/house|roof|garage|shed|structure|fence|building/)) job.nearStructure = { value: true, source: 'inferred' };
  if (has(/power ?line|utility line|service drop|lines overhead/)) job.powerLines = { value: true, source: 'inferred' };
  if (has(/tight access|no access|backyard|gate|narrow|limited access/)) job.access = { value: 'tight', source: 'inferred' };
  else if (has(/easy access|open access|front yard|driveway access/)) job.access = { value: 'easy', source: 'inferred' };
  if (has(/restricted drop|no drop zone|tight drop|must be rigged|rigging required/)) job.dropZone = { value: 'restricted', source: 'inferred' };
  else if (has(/open drop|clear drop|room to fell|can be felled/)) job.dropZone = { value: 'open', source: 'inferred' };

  const rig = c.wk_rigging_level as Rigging | null;
  if (rig && ['none', 'basic', 'intermediate', 'advanced'].includes(rig)) job.rigging = { value: rig, source: 'hint' };
  if (c.wk_crane_required || has(/\bcrane\b/)) job.craneIndicated = { value: true, source: c.wk_crane_required ? 'hint' : 'inferred' };
  if (Number(c.wk_loads) > 0) job.loads = { value: Number(c.wk_loads), source: 'hint' };
  if (c.wk_stump && Number(c.wk_stump_diameter_inches) > 0) job.stumpDiameterInches = { value: Number(c.wk_stump_diameter_inches), source: 'known' };

  const tc = text.match(/(\d+|two|three|four)\s+trees/);
  if (tc) {
    const map: Record<string, number> = { two: 2, three: 3, four: 4 };
    job.treeCount = { value: map[tc[1]] ?? Number(tc[1]), source: 'inferred' };
  }
  return job;
}
