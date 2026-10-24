import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LeadPhoto } from '@/components/LeadPhoto';
import { Loader2, CheckCircle2, ExternalLink } from 'lucide-react';
import { usePurchaseLeadWithStripe, usePaymentMethod, useSetupPaymentMethod } from '@/hooks/usePayment';
import { useHasPurchasedLead } from '@/hooks/useLeads';
import { toast } from 'sonner';

type IntentRow = {
  id: string;
  lead_id: string;
  quoted_unlock_fee: number;
  status: string;
  expires_at: string;
};

type LeadPreview = {
  id: string;
  city: string;
  job_type: string;
  photo_url: string;
  estimated_cost_min: number;
  estimated_cost_max: number;
  created_at: string;
};

/**
 * Web destination for the iOS external unlock handoff.
 * URL: /mobile/unlock?intent=<token>
 *
 * The actual payment goes through the existing `purchase-lead` edge function
 * (Stripe + wallet), which already enforces the 3-contractor cap and writes
 * lead access in Supabase. On success we redirect to a deep link that returns
 * the user to the iOS app.
 */
export default function MobileUnlock() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const token = params.get('intent') ?? '';

  const [intent, setIntent] = useState<IntentRow | null>(null);
  const [lead, setLead] = useState<LeadPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);

  const { data: paymentStatus } = usePaymentMethod();
  const setupPayment = useSetupPaymentMethod();
  const purchase = usePurchaseLeadWithStripe();
  const { data: alreadyPurchased } = useHasPurchasedLead(intent?.lead_id ?? '');

  // Send unauthenticated visitors to login, then back here.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const redirect = encodeURIComponent(`/mobile/unlock?intent=${encodeURIComponent(token)}`);
      navigate(`/login?redirect=${redirect}`, { replace: true });
    }
  }, [user, authLoading, navigate, token]);

  // Look up intent + lead preview.
  useEffect(() => {
    if (!user || !token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Hash the token client-side and match server hash via RPC-less query
        // through a small edge endpoint would be ideal, but for simplicity we
        // look up our own intents (RLS scoped to user_id) and match in-memory.
        const enc = new TextEncoder().encode(token);
        const digest = await crypto.subtle.digest('SHA-256', enc);
        const hex = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0')).join('');

        const { data: rows, error: e1 } = await supabase
          .from('mobile_unlock_intents')
          .select('id, lead_id, quoted_unlock_fee, status, expires_at, token_hash')
          .eq('token_hash', hex)
          .limit(1);
        if (e1) throw e1;
        const row = rows?.[0];
        if (!row) throw new Error('This unlock link is invalid or has expired.');
        if (row.status !== 'created') throw new Error('This unlock link has already been used.');
        if (new Date(row.expires_at).getTime() < Date.now()) {
          throw new Error('This unlock link has expired. Please tap "Unlock This Lead" again in the app.');
        }
        if (cancelled) return;
        setIntent(row);

        const { data: ld, error: e2 } = await supabase
          .from('leads')
          .select('id, city, job_type, photo_url, estimated_cost_min, estimated_cost_max, created_at')
          .eq('id', row.lead_id)
          .maybeSingle();
        if (e2 || !ld) throw e2 ?? new Error('Lead not found');
        if (!cancelled) setLead(ld as LeadPreview);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not load unlock');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, token]);

  const completeUnlock = async () => {
    if (!intent || !lead) return;
    try {
      if (!paymentStatus?.has_payment_method) {
        setupPayment.mutate();
        return;
      }
      await purchase.mutateAsync({ leadId: lead.id });
      // mark intent consumed (best-effort)
      await supabase
        .from('mobile_unlock_intents')
        .update({ status: 'consumed', consumed_at: new Date().toISOString() })
        .eq('id', intent.id);
      setUnlocked(true);
    } catch (e: any) {
      toast.error(e?.message ?? 'Payment failed');
    }
  };

  const returnToApp = () => {
    if (!lead) return;
    // Try the custom scheme first, fall back to the universal link.
    const deep = `treecheck://lead-unlocked?lead_id=${lead.id}`;
    const universal = `/app/lead-unlocked?lead_id=${lead.id}`;
    try {
      window.location.href = deep;
      setTimeout(() => { window.location.href = universal; }, 800);
    } catch {
      window.location.href = universal;
    }
  };

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle>Unlock unavailable</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => navigate('/dashboard')} className="w-full">Go to dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (unlocked && lead) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            <CardTitle>Lead Unlocked</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This lead has been added to Your Leads.
            </p>
            <Button onClick={returnToApp} className="w-full gradient-primary">
              <ExternalLink className="mr-2 h-4 w-4" /> Return to TreeCheck App
            </Button>
            <Button variant="outline" onClick={() => navigate('/dashboard/purchased')} className="w-full">
              View on Web
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!lead || !intent) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full overflow-hidden">
        <LeadPhoto photoUrl={lead.photo_url} aspectRatio="4/3" objectFit="contain" />
        <CardHeader>
          <div className="text-sm text-muted-foreground">{lead.city} · {lead.job_type}</div>
          <CardTitle className="text-xl">
            Estimated job value: ${Number(lead.estimated_cost_min).toLocaleString()} – ${Number(lead.estimated_cost_max).toLocaleString()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-base">
            Unlock fee: <span className="font-semibold">${Number(intent.quoted_unlock_fee).toFixed(2)}</span>
          </div>
          {alreadyPurchased ? (
            <Button onClick={returnToApp} className="w-full">Already unlocked — return to app</Button>
          ) : (
            <Button onClick={completeUnlock} disabled={purchase.isPending} className="w-full gradient-primary">
              {purchase.isPending
                ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing…</>)
                : (paymentStatus?.has_payment_method
                    ? `Confirm Unlock — $${Number(intent.quoted_unlock_fee).toFixed(2)}`
                    : 'Add Payment Method to Continue')}
            </Button>
          )}
          <p className="text-[11px] text-center text-muted-foreground">
            Secure payment processed on TreeCheck Web.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
