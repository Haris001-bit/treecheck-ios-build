// The dashboard pages a crew-only account (contract climber, ground worker or network sub) may open: its own menu,
// plus the pages its texts and pushes link to. DashboardLayout sends a crew-only account anywhere else back to
// Jobs to Bid, so typing an owner page's address (Settings, Jobs, Scout) doesn't open it (signup test, 2026-10-19).
export const CREW_PATHS: readonly string[] = [
  '/dashboard/crew-bids',
  '/dashboard/crew-availability',
  '/dashboard/ground-hours',
  '/dashboard/profile',
  '/dashboard/notifications',
  '/dashboard/subscription-info',
];

export function isCrewPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '');
  return CREW_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}
