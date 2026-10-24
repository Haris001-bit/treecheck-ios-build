import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useIsCrewOnly } from '@/hooks/useCrew';
import Dashboard from '@/pages/Dashboard';

/** Decide the session landing page before mounting Available Leads or its queries. */
export function DashboardLanding() {
  const { isCrewOnly, loading } = useIsCrewOnly();
  if (loading) return <div className="flex justify-center p-8" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (isCrewOnly) return <Navigate to="/dashboard/crew-bids" replace />;
  let seen = false;
  try { seen = sessionStorage.getItem('home-seen-session') === '1'; } catch { /* Home is the safe default. */ }
  if (!seen) return <Navigate to="/dashboard/home" replace />;
  return <Dashboard />;
}