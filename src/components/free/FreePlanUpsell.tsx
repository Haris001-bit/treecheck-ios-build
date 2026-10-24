import { Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useFreePlan } from '@/hooks/useFreePlan';
import { isNativeStoreBilling } from '@/lib/platform';
import { FreePlanCta } from './FreePlanCta';
import { FreeVsTrial } from './FreeVsTrial';

/** What a Free owner sees at a limit or on a locked preview: the message, what the trial adds, one button. */
export function FreePlanUpsell({ title, body, showComparison = true }: { title: string; body: string; showComparison?: boolean }) {
  const free = useFreePlan();
  const trialUsed = free.data?.trial_used === true;
  // The website trial comparison; the phone apps' trial is the store's, shown on the plan screen.
  const safe = isNativeStoreBilling();
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 mt-0.5 shrink-0 text-primary" />
          <div className="space-y-1">
            <h3 className="font-bold">{title}</h3>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        </div>
        {showComparison && !trialUsed && !safe && (
          <FreeVsTrial trialNote="You aren't charged during the trial. After 14 days, pick a plan or stay on Free." />
        )}
        <FreePlanCta className="w-full" />
      </CardContent>
    </Card>
  );
}
