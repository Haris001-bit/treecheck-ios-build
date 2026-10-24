import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Tab = { to: string; label: string; end?: boolean; ownerOnly?: boolean; matchPaths?: string[] };

const GROUPS: Tab[][] = [
  [
    { to: '/dashboard', label: 'Available', end: true },
    { to: '/dashboard/purchased', label: 'Purchased' },
    { to: '/dashboard/service-areas', label: 'Service Areas' },
    { to: '/dashboard/pricing', label: 'Premium' },
  ],
  [
    { to: '/dashboard/team', label: 'Office team' },
    { to: '/dashboard/crew-network', label: 'Subcontractors' },
  ],
  [
    { to: '/dashboard/start', label: 'Setup checklist', ownerOnly: true },
    { to: '/dashboard/scout-rates', label: 'Pricing rates', ownerOnly: true },
    { to: '/dashboard/how-we-work', label: 'How we work', ownerOnly: true },
    { to: '/dashboard/integrations/jobber', label: 'Integrations' },
    { to: '/dashboard/profile', label: 'Profile' },
    { to: '/dashboard/settings/admin', label: 'Admin', matchPaths: ['/dashboard/pay'] },
  ],
];

/** Tab strip shown above pages that were merged into one menu item. */
export function HubTabs() {
  const { pathname } = useLocation();
  const { isTeamMember } = useAuth();
  const group = GROUPS.find((g) => g.some((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)) || t.matchPaths?.includes(pathname)));
  if (!group) return null;
  if (isTeamMember && !group.some((t) => t.to === '/dashboard/settings/admin')) return null;
  return (
    <div className="border-b border-border bg-background px-4 pt-3 lg:px-8">
      <nav className="flex gap-1 overflow-x-auto">
        {group.filter((t) => !isTeamMember || !t.ownerOnly).map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
                isActive || t.matchPaths?.includes(pathname) ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
