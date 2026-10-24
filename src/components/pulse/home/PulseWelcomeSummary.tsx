// Under "Welcome back": owners with Financial Pulse numbers get a plain-language month summary written by
// fixed rules from pulse-get (no AI ever sees Pulse data). Everyone else sees `otherwise`.
// Pulse code: Home.tsx only places this and never reads Pulse data itself.
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePulseAccess } from '@/hooks/pulse/usePulseAccess';
import { pulseHomeSummary } from '@/lib/pulse/api';
import { homeStateOf } from './homeState';
import { pulseMonthWords } from './pulseMonthWords';

export function PulseWelcomeSummary({ otherwise }: { otherwise: ReactNode }) {
  const { loading, allowed, ownerId } = usePulseAccess();
  // Same query as the Pulse card below, so it is fetched once.
  const query = useQuery({
    queryKey: ['pulse', ownerId, 'home-summary'],
    queryFn: pulseHomeSummary,
    enabled: allowed && !!ownerId,
    staleTime: 60_000,
    retry: 1,
  });
  if (loading || (allowed && query.isLoading)) {
    return <p className="mt-2 min-h-10 text-sm text-muted-foreground" role="status">Reading this month…</p>;
  }
  const state = allowed && query.data ? homeStateOf(query.data, Date.now()) : null;
  const words = state?.kind === 'numbers' ? pulseMonthWords(state.summary) : null;
  if (!words) return <>{otherwise}</>;
  return (
    <div className="mt-2 max-w-2xl space-y-1">
      <p className="text-sm leading-relaxed">{words.join(' ')}</p>
      <p className="text-xs text-muted-foreground">From your Financial Pulse numbers.</p>
    </div>
  );
}
