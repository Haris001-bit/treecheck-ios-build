import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseScoutNotes, buildWebhookReading } from '../../supabase/functions/_shared/calibrationWebhook';

// A real Scout webhook answer (format as returned for live Scout photos).
const SAMPLE = 'OBSERVATIONS - Estimated DBH: Approximately 13-24 inches - Estimated height: Approximately 40-60 feet - Canopy density: Full - Crown structure: 2 co-dominant leaders (~6-12 ft union) - Condition: Healthy - Proximity to structures: Close to house/shed - Accessibility: Clear - Disposal: 1 load - Crane required: No - Clear drop zone: No PRICE BREAKDOWN - Base price (DBH bucket): $480 - Height: $85 - Total: $1200 PRICING NOTES Full canopy and two co-dominant leaders increase rigging time.';

describe('every calibration detail comes from the Scout webhook answer', () => {
  const r = parseScoutNotes(SAMPLE);
  it('trunk and height (ranges read as their middle)', () => {
    expect(r.dbh_inches.value).toBe(19);
    expect(r.height_ft.value).toBe(50);
  });
  it('canopy, leaders, condition', () => {
    expect(r.canopy_dense.value).toBe(true);
    expect(r.multiple_leaders.value).toBe(true);
    expect(r.condition.value).toBe('healthy');
  });
  it('structures, access, drop zone, crane, debris loads', () => {
    expect(r.near_structure.value).toBe(true);
    expect(r.access.value).toBe('easy');
    expect(r.drop_zone.value).toBe('restricted');
    expect(r.crane_indicated.value).toBe(false);
    expect(r.loads.value).toBe(1);
  });
  it('a detail the webhook did not mention stays unknown', () => {
    expect(r.power_lines.value).toBeNull();
    expect(r.power_lines.confidence).toBe('unknown');
  });
  it('reads the answer the webhook gave a calibration photo (4+ leaders, minor obstructions)', () => {
    const c = parseScoutNotes('OBSERVATIONS - Crown structure: 4+ leaders, union around 5-6 ft - Accessibility: Minor obstructions (backyard access)');
    expect(c.multiple_leaders.value).toBe(true);
    expect(c.access.value).toBe('moderate');
  });
  it("each detail reads as one of Scout's own answers, by name", () => {
    const c = parseScoutNotes('- Estimated DBH: Approximately 16-20 inches - Canopy density: Minimal - Crown structure: 3 leaders, union ~4-5 ft - Condition: Diseased/Dead - Proximity to structures: Close to house/deck - Accessibility: Minor obstructions (deck, AC unit) - Disposal: 1 load - Crane required: No - Clear drop zone: No');
    expect(c.canopy_dense.label).toBe('Minimal');
    expect(c.multiple_leaders.label).toBe('3 leaders or union ~3–6 ft');
    expect(c.condition.label).toBe('Diseased/Damaged/Dead');
    expect(c.near_structure.label).toBe('House/Shed');
    expect(c.access.label).toBe('Minor obstructions');
    expect(c.loads.label).toBe('1 load');
    expect(c.crane_indicated.label).toBe('No');
    expect(c.drop_zone.label).toBe('No');
  });
  it("Scout's answer list carries no prices or percentages", () => {
    const src = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', '_shared', 'scoutChoices.ts'), 'utf8');
    expect(src).not.toMatch(/\$\d|\d+\s*%/);
  });
  it("reads Mark's Oct 29 answer: minimal canopy is not dense, one tree when Scout gives no count", () => {
    const c = parseScoutNotes('- Estimated DBH: Approximately 16-20 inches - Estimated height: Approximately 45-55 feet - Canopy density: Minimal - Crown structure: 3 leaders, union ~4-5 ft - Condition: Diseased/Dead - Disposal: 1 load');
    expect(c.canopy_dense.value).toBe(false);
    expect(c.tree_count.value).toBe(1);
    expect(c.power_lines.value).toBeNull();
  });
  it('reads a single number and an open-ended 36+', () => {
    expect(parseScoutNotes('OBSERVATIONS - Estimated DBH: Approximately 8 inches').dbh_inches.value).toBe(8);
    expect(parseScoutNotes('OBSERVATIONS - Estimated DBH: Approximately 36+ inches').dbh_inches.value).toBe(36);
  });
  it('never keeps the price or the price breakdown', () => {
    const reading = buildWebhookReading({ price: 1200, notes: SAMPLE });
    const text = JSON.stringify(reading);
    expect(text).not.toContain('1200');
    expect(text).not.toContain('$');
    expect(text).not.toContain('PRICE BREAKDOWN');
  });
});

describe('calibration sends Scout the same fields as a live Scout photo, and nothing else happens', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'supabase', 'functions', 'calibration-analyze', 'index.ts'), 'utf8');
  it('uses the live Scout webhook with the address, service, trunk size, notes and company guidance', () => {
    expect(src).toContain('https://treecheck.app.n8n.cloud/webhook/scout-tree-automation');
    for (const f of ['photo_urls', 'notes_summary', 'service: "Tree Removal"', 'circumference_inches', 'diameter_inches', 'address:', 'company_guidance: learning.block']) expect(src).toContain(f);
  });
  it('owners never type an address: the server sends a hidden stand-in and does not save it', () => {
    const wizard = readFileSync(join(__dirname, '..', 'components', 'production', 'CalibrationWizard.tsx'), 'utf8');
    expect(wizard).not.toContain('Job address');
    expect(wizard).not.toMatch(/body: \{[^}]*address/);
    expect(src).toContain('const address = CALIBRATION_STAND_IN_ADDRESS;');
    expect(src).toContain('owner_hints: { text: hints || null, circumference_inches');
  });
  it('no in-app AI reader, no texts, no Scout learning rows', () => {
    expect(src).not.toContain('/v1/responses');
    expect(src).not.toContain('api.twilio.com');
    expect(src).not.toContain('recordScoutSent');
  });
});
