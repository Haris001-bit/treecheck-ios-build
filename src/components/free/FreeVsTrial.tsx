import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FREE_INCLUDES, TRIAL_INCLUDES } from '@/lib/freePlan';

/** Side-by-side: what the 14-day trial adds versus Free. Same wording on signup and at every Free limit. */
export function FreeVsTrial({ trialNote, trialAction, freeAction }: { trialNote: string; trialAction?: ReactNode; freeAction?: ReactNode }) {
  const item = (text: string) => (
    <li key={text} className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 mt-0.5 shrink-0 text-primary" /><span>{text}</span></li>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2 text-left">
      <div className="rounded-lg border-2 border-primary p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-black">14-day free trial</h3>
          <Badge>Recommended</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Everything for 14 days:</p>
        <ul className="space-y-1.5">{TRIAL_INCLUDES.map(item)}</ul>
        <p className="text-xs text-muted-foreground">{trialNote}</p>
        {trialAction}
      </div>
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-black">Free</h3>
        <p className="text-xs text-muted-foreground">Free for as long as you want:</p>
        <ul className="space-y-1.5">{FREE_INCLUDES.map(item)}</ul>
        {freeAction}
      </div>
    </div>
  );
}
