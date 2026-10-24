import { useFreePlan } from '@/hooks/useFreePlan';
import { usageLine } from '@/lib/freePlan';
import { FreePlanCta } from './FreePlanCta';

type Kind = 'jobs' | 'scout' | 'dma';
const NOUN: Record<Kind, string> = { jobs: 'jobs', scout: 'Scout previews', dma: 'DMA previews' };

/** A quiet line for Free owners: "3 of 5 free jobs used this month" and the one trial / upgrade button. */
export function FreeUsageNote({ kind, className = '' }: { kind: Kind; className?: string }) {
  const free = useFreePlan();
  const s = free.data;
  if (!s || s.plan !== 'free') return null;
  const used = kind === 'jobs' ? s.jobs_used : kind === 'scout' ? s.scout_used : s.dma_used;
  const limit = kind === 'jobs' ? s.jobs_limit : kind === 'scout' ? s.scout_limit : s.dma_limit;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${className}`} role="status">
      <span className="text-muted-foreground">Free plan · {usageLine(used, limit, NOUN[kind])}</span>
      <FreePlanCta size="sm" />
    </div>
  );
}
