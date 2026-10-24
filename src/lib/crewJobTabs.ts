// Sorts a sub's jobs into tabs so old and closed jobs stop crowding out new work.
export type CrewTab = 'open' | 'mine' | 'past' | 'archived';

const allPassed = (dates: string[] | null | undefined, today: string) =>
  !!dates && dates.length > 0 && dates.every((d) => d < today);

export function requestTab(
  r: { status: string; awarded_bid_id?: string | null; workflow_status?: string | null; offered_dates?: string[] | null },
  mine: { id: string; status: string } | null | undefined,
  today: string,
): CrewTab {
  const iWon = !!mine && (mine.status === 'hired' || (mine.status === 'won' && r.awarded_bid_id === mine.id));
  if (iWon) return r.workflow_status === 'job_complete' ? 'past' : 'mine';
  if (mine?.status === 'lost') return 'archived';
  if (r.status !== 'open') return 'archived';
  if (allPassed(r.offered_dates, today)) return 'archived';
  return 'open';
}

export function dispatchTab(
  d: { status: string; awarded_date?: string | null; offered_dates?: string[] | null },
  claim: { status: string } | null | undefined,
  today: string,
): CrewTab {
  if (claim?.status === 'confirmed' && d.status === 'filled') {
    return d.awarded_date && d.awarded_date < today ? 'past' : 'mine';
  }
  if (d.status === 'open' && !allPassed(d.offered_dates, today)) return 'open';
  return 'archived';
}
