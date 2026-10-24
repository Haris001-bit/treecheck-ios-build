import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';

/**
 * Universal-link landing for /app/lead-unlocked?lead_id=...
 * On native iOS this is invoked via `appUrlOpen` (see useNativeBridge).
 * On web it's a small confirmation page that links to Your Leads.
 */
export default function LeadUnlockedReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const leadId = params.get('lead_id') ?? '';
  const [status, setStatus] = useState<'polling' | 'ready' | 'timeout'>('polling');

  useEffect(() => {
    if (Capacitor.isNativePlatform()) Browser.close().catch(() => {});
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['purchased-leads'] });
    qc.invalidateQueries({ queryKey: ['mobile-entitlements'] });
  }, [qc]);

  useEffect(() => {
    if (!leadId) return;
    let stopped = false;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      const { data } = await supabase
        .from('lead_purchases')
        .select('id')
        .eq('lead_id', leadId)
        .limit(1);
      if (stopped) return;
      if ((data?.length ?? 0) > 0) {
        setStatus('ready');
        return;
      }
      if (tries >= 10) {
        setStatus('timeout');
        return;
      }
      setTimeout(tick, 1500);
    };
    tick();
    return () => { stopped = true; };
  }, [leadId]);

  const goToLead = () => {
    qc.invalidateQueries({ queryKey: ['purchased-leads'] });
    navigate('/dashboard/purchased', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          {status === 'ready' ? (
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
          ) : (
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          )}
          <CardTitle>
            {status === 'ready' ? 'Lead Added' : 'Refreshing your account…'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {status === 'timeout' && (
            <p className="text-sm text-muted-foreground">
              We're still syncing your unlock. Try refreshing in a moment.
            </p>
          )}
          <Button onClick={goToLead} className="w-full gradient-primary">
            {status === 'ready' ? 'View Your Leads' : 'Refresh'}
          </Button>
          <Button variant="outline" onClick={() => navigate('/dashboard')} className="w-full">
            Back to Leads
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
