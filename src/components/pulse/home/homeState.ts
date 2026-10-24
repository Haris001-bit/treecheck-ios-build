// Home's Pulse card: which state a summary reply shows, and the change colours (engine-6). Pure, so the card's
// states are tested without the server.
import type { PulseHomeResult } from '@/lib/pulse/api';
import type { Change, HomeSummary } from '../../../../supabase/functions/_shared/pulse/engine';
import { BAD_TEXT, GOOD_TEXT } from '../tone';

export type PulseHomeState =
  | { kind: 'not_allowed' }
  | { kind: 'loading' }
  | { kind: 'setup' }
  | { kind: 'error' }
  | { kind: 'arriving' }
  | { kind: 'empty' }
  | { kind: 'numbers'; summary: HomeSummary; nowMs: number };

/** What the card shows for a summary reply. */
export function homeStateOf(r: PulseHomeResult, nowMs: number): PulseHomeState {
  if (r.ok === false) return { kind: 'error' };
  if (!r.setup_done) return { kind: 'setup' };
  if (r.summary.arriving) return { kind: 'arriving' };
  if (!r.summary.month || !r.summary.month.current.has_data) return { kind: 'empty' };
  return { kind: 'numbers', summary: r.summary, nowMs };
}

/** The Pulse screen's colour rule: money in and profit are good when up, costs when down; grey when not like for like. */
export function changeTone(c: Change, costRow: boolean, fair: boolean): string {
  if (!fair || c.amount === 0) return 'text-muted-foreground';
  return (costRow ? c.amount <= 0 : c.amount >= 0) ? GOOD_TEXT : BAD_TEXT;
}
