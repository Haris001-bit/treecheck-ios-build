import type { AiCharacteristics } from '@/lib/production/calibration';
// Scout's own answer choices and notes reader, shared with the server so the screen reads Scout the same way.
export { SCOUT_CHOICES, type ScoutChoiceKey } from '../../supabase/functions/_shared/scoutChoices';
export { parseScoutNotes } from '../../supabase/functions/_shared/calibrationWebhook';

/** Trunk/height reading the Scout webhook (n8n) saved on a calibration (see supabase/functions/_shared/calibrationWebhook.ts). */
export type WebhookNumber = { value: number | null; confidence: 'high' | 'medium' | 'low' | 'unknown'; low?: number; high?: number; text?: string };
export type WebhookReading = {
  characteristics: AiCharacteristics;
  dbh_inches: WebhookNumber; height_ft: WebhookNumber; notes: string | null; received_at: string;
};

/** How long the confirm step waits for the webhook before letting the owner type the numbers in. */
export const WEBHOOK_WAIT_MS = 5 * 60 * 1000;

/** "13–24 in" for a range, "8 in" for one number. */
export function rangeLabel(w: WebhookNumber | undefined, unit: string): string | null {
  if (!w || w.value == null) return null;
  if (w.low != null && w.high != null && w.low !== w.high) return `${w.low}–${w.high} ${unit}`;
  return `${w.value} ${unit}`;
}
