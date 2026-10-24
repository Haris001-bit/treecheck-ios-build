import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Camera, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { usePlansOpen } from '@/hooks/useBillingRollout';
import { CATALOG, formatCents } from '@/lib/pricing/catalog';

const FEATURES = [
  'Snap a photo of the tree and talk through the job — no forms',
  'Get a priced estimate on the spot, built from your own rates',
  'Send the estimate to the customer before you leave the driveway',
  'Every capture lands in your inbox for review and approval',
];

interface Props {
  /** Show reactivate wording instead of the trial offer. */
  lapsed?: boolean;
}

export function ScoutUpsell({ lapsed = false }: Props) {
  const [loading, setLoading] = useState(false);
  // Once the company plans are open on the website, Scout comes with a plan from the plan picker (payments milestone).
  const plansOpen = usePlansOpen();

  const start = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-scout-checkout');
      const message = (data as { error?: string } | null)?.error;
      if (error || message) throw new Error(message || error?.message || 'Could not start checkout');
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error('Could not start checkout');
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
      setLoading(false);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-2xl mx-auto">
      <Card>
        <CardContent className="pt-8 pb-8 space-y-6">
          <div className="text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Camera className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-2xl font-bold">Scout — estimates from the driveway</h2>
            <p className="text-muted-foreground">
              Scout turns a photo and a voice note into a priced estimate in under a minute.
            </p>
          </div>

          <ul className="space-y-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex gap-2 text-sm">
                <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {plansOpen ? <>
            <div className="rounded-lg border p-4 text-center space-y-1">
              <p className="text-2xl font-bold">{formatCents(CATALOG.core.month + CATALOG.scout.month)}/month</p>
              <p className="text-sm text-muted-foreground">for Core with one Scout license, or {formatCents(CATALOG.core.month)}/month for Core alone</p>
            </div>
            <div className="text-center space-y-2">
              <Button asChild size="lg" className="w-full sm:w-auto"><Link to="/dashboard/plans">Choose a plan</Link></Button>
              <p className="text-xs text-muted-foreground">14 days free if your company hasn't had a trial. Cancel anytime.</p>
            </div>
          </> : <>
          <div className="rounded-lg border p-4 text-center space-y-1">
            <p className="text-2xl font-bold">$50/month</p>
            <p className="text-sm text-muted-foreground">
              for the account owner, plus $35/month for each additional team member
            </p>
          </div>

          <div className="text-center space-y-2">
            <Button onClick={start} disabled={loading} size="lg" className="w-full sm:w-auto">
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {lapsed ? 'Reactivate Scout' : 'Start 14-day free trial'}
            </Button>
            <p className="text-xs text-muted-foreground">
              {lapsed
                ? 'Billing restarts today. Cancel anytime.'
                : 'Card required. Free for 14 days, then billed monthly. Cancel anytime.'}
            </p>
          </div>
          </>}
        </CardContent>
      </Card>
    </div>
  );
}
