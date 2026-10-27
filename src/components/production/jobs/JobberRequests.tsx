import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { productionCall } from '@/hooks/useProductionWork';
import type { OpenRequest } from '@/lib/production/jobberExtras';

const SHOWN = 10;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

/**
 * Crew work > Estimates: Jobber requests still waiting on an estimate, each with Start estimate (the customer comes
 * filled in and the quote names the request). Part of the Jobber approval extras: shows nothing while they are off.
 */
export function JobberRequests({ on }: { on: boolean }) {
  const q = useQuery({
    queryKey: ['production-jobber-requests'],
    enabled: on,
    staleTime: 60_000,
    queryFn: () => productionCall<{ on: boolean; requests: OpenRequest[] }>('production-estimate', { action: 'jobber_requests' }),
  });
  const rows = q.data?.on ? q.data.requests : [];
  if (!on || !rows.length) return null;
  return (
    <Card className="p-3 space-y-2">
      <div className="font-semibold text-sm">Jobber requests waiting on an estimate</div>
      {rows.slice(0, SHOWN).map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{r.title}</div>
            <div className="text-xs text-muted-foreground truncate">{[r.customer.address, day(r.createdAt)].filter(Boolean).join(' · ')}</div>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link to="/dashboard/instant-estimator/crew" state={{ fromRequest: r.customer }}>Start estimate</Link>
          </Button>
        </div>
      ))}
      {rows.length > SHOWN && <p className="text-xs text-muted-foreground">And {rows.length - SHOWN} more in Jobber.</p>}
    </Card>
  );
}
