import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import treecheckLogo from '@/assets/treecheck-white-login.png';
import { reportSeriousError } from '@/lib/errorReporter';

export default function StartTrialSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const sessionId = params.get('session_id');
    if (!sessionId) { setState('error'); setMsg('Missing session id'); return; }
    (async () => {
      // Call finalize as a fallback in case the Stripe webhook is delayed.
      // The webhook is the authoritative writer; finalize is idempotent.
      const { data, error } = await supabase.functions.invoke('finalize-trial-signup', {
        body: { session_id: sessionId },
      });
      if (error || data?.error) {
        const failure = error?.message || data?.error || 'Failed to activate trial';
        setState('error');
        setMsg(failure);
        reportSeriousError('activate paid company trial', failure, 'company signup');
        return;
      }
      setState('ok');
    })();
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img src={treecheckLogo} alt="TreeCheck" className="h-14 mx-auto mb-3" />
          {state === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary mb-2" />
              <CardTitle>Activating your trial…</CardTitle>
              <CardDescription>Setting up your account. This takes a few seconds.</CardDescription>
            </>
          )}
          {state === 'ok' && (
            <>
              <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-2" />
              <CardTitle>You're in — 14 days free</CardTitle>
              <CardDescription>Your TreeCheck trial is active.</CardDescription>
            </>
          )}
          {state === 'error' && (
            <>
              <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-2" />
              <CardTitle>Something went wrong</CardTitle>
              <CardDescription className="text-destructive">{msg}</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'ok' && (
            <>
              <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/40">
                <div className="font-medium mb-1">What's included in your trial</div>
                <div>✓ Scout — photo a tree, get an estimate, alert your team</div>
                <div>✓ Team members — add teammates, billing starts after trial</div>
                <div>✓ DMA — build sample job posts on our demo site</div>
                <div className="text-muted-foreground pt-1">
                  Postcards, publishing to your own website, and Jobber sync are
                  add-ons you can enable anytime.
                </div>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Sign in with the email and password you just created.
              </p>
              <Button className="w-full" onClick={() => navigate('/login')}>Sign in</Button>
            </>
          )}
          {state === 'error' && (
            <>
              <p className="text-sm text-muted-foreground">
                We recorded this issue for immediate review. If your account isn't ready
                in a minute, contact support and we'll finish setup manually.
              </p>
              <Button variant="outline" className="w-full" onClick={() => navigate('/login')}>Go to sign in</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
