import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useIsCrewOnly } from '@/hooks/useCrew';

/** Decide the session landing page: crew-only accounts go to Jobs to Bid, everyone else to Home. Leads stay reachable at /dashboard/leads. */
export function DashboardLanding() {
  const { isCrewOnly, loading } = useIsCrewOnly();
  if (loading) return <div className="flex justify-center p-8" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (isCrewOnly) return <Navigate to="/dashboard/crew-bids" replace />;
  return <Navigate to="/dashboard/home" replace />;
}
