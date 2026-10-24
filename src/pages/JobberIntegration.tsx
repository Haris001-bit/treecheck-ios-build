import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, CheckCircle2, Link as LinkIcon, Download, Unlink } from 'lucide-react';
import { toast } from 'sonner';

export default function JobberIntegration() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const marketplaceStarted = useRef(false);

  const jobberError = params.get('jobber_error');

  useEffect(() => {
    if (params.get('connected') === '1') toast.success('Jobber connected!');
    if (jobberError) toast.error(jobberError);
  }, [params, jobberError]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // A connection Jobber has disconnected (disconnected_at set) no longer counts.
      const withStatus = await supabase
        .from('jobber_tokens')
        .select('id, updated_at, disconnected_at')
        .eq('contractor_id', user.id)
        .maybeSingle();
      if (!withStatus.error) {
        const row = withStatus.data as unknown as { disconnected_at?: string | null } | null;
        setConnected(!!row && !row.disconnected_at);
        return;
      }
      const { data } = await supabase
        .from('jobber_tokens')
        .select('id, updated_at')
        .eq('contractor_id', user.id)
        .maybeSingle();
      setConnected(!!data);
    })();
  }, [user, params]);

  const connect = async () => {
    setWorking(true);
    try {
      // Back to this page on the address the owner is signed in on (the sign-in is kept per address).
      const { data, error } = await supabase.functions.invoke('jobber-connect', {
        body: { return_to: `${window.location.origin}/dashboard/integrations/jobber` },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      // Jobber's login page can't be embedded in an iframe (Lovable preview),
      // so open a new tab when we're not the top-level window.
      const embedded = window.self !== window.top;
      if (embedded) {
        window.open(data.authorize_url, '_blank', 'noopener,noreferrer');
        toast.info('Continue in the new tab to authorize Jobber.');
        setWorking(false);
      } else {
        window.location.href = data.authorize_url;
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not start Jobber connection');
      setWorking(false);
    }
  };

  // Connect pressed in Jobber's App Marketplace lands here with ?from=jobber (jobber-oauth-callback):
  // start the normal connection once for whoever is signed in.
  const fromJobber = params.get('from') === 'jobber';
  useEffect(() => {
    if (!fromJobber || !user || marketplaceStarted.current) return;
    marketplaceStarted.current = true;
    const next = new URLSearchParams(params);
    next.delete('from');
    setParams(next, { replace: true });
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromJobber, user]);

  // Tells Jobber (appDisconnect) and clears the connection; jobber-disconnect is owner only.
  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-disconnect', { body: {} });
      if (error) throw new Error('Could not disconnect Jobber. Please try again in a minute.');
      if (data?.error) throw new Error(data.error);
      setConnected(false);
      toast.success('Jobber disconnected');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not disconnect Jobber');
    } finally {
      setDisconnecting(false);
    }
  };


  const runBackfill = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('jobber-backfill');
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const { created = 0, updated = 0, skipped_open = 0, errors = 0 } = data || {};
      toast.success(
        `Sync complete — ${created} imported, ${updated} updated, ${skipped_open} open jobs skipped${
          errors ? `, ${errors} errors` : ''
        }`,
      );
      setLastSync(new Date().toLocaleString());
    } catch (e: any) {
      toast.error(e?.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Jobber Integration</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Two-way sync with Jobber: leads you close in TreeCheck are pushed to Jobber
        (client + invoice), and jobs you close in Jobber flow back here.
      </p>

      {jobberError && (
        <Card className="p-4 mb-4 border-destructive/50 bg-destructive/5">
          <div className="font-semibold text-destructive mb-1">Jobber connection failed</div>
          <div className="text-sm text-muted-foreground break-words">{jobberError}</div>
        </Card>
      )}

      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Jobber connection</div>
            <div className="text-sm text-muted-foreground">
              {connected === null ? 'Checking…' : connected ? 'Active' : 'Not connected'}
            </div>
          </div>
          {connected && <Badge className="gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Connected</Badge>}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={connect} disabled={working || disconnecting} className="w-full sm:w-auto">
            {working ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirecting…</>
            ) : connected ? (
              <><LinkIcon className="w-4 h-4 mr-2" />Reconnect Jobber</>
            ) : (
              <><LinkIcon className="w-4 h-4 mr-2" />Connect Jobber</>
            )}
          </Button>
          {connected && (
            <Button
              variant="outline"
              onClick={() => setConfirmDisconnect(true)}
              disabled={working || disconnecting}
              className="w-full sm:w-auto"
            >
              {disconnecting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Disconnecting…</>
              ) : (
                <><Unlink className="w-4 h-4 mr-2" />Disconnect Jobber</>
              )}
            </Button>
          )}
        </div>

        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <div className="font-medium text-foreground">Before you connect</div>
          <div>
            1. Sign in to Jobber first at{' '}
            <a href="https://secure.getjobber.com" target="_blank" rel="noopener noreferrer" className="underline">
              secure.getjobber.com
            </a>{' '}
            in this same browser — use the company account, not the Developer Center login.
          </div>
          <div>2. You must be the account owner or an admin to authorize apps.</div>
          <div>3. Then come back here and tap Connect Jobber — you'll only see an "Allow" screen.</div>
        </div>
      </Card>


      {connected && (
        <Card className="p-6 space-y-4 mt-4">
          <div>
            <div className="font-semibold">Import existing Jobber history</div>
            <div className="text-sm text-muted-foreground">
              Pulls your recent Jobber jobs (up to ~500) and creates matching leads
              &amp; closeouts in TreeCheck. Safe to run again — existing records are
              updated, not duplicated.
            </div>
          </div>
          <Button onClick={runBackfill} disabled={syncing} className="w-full sm:w-auto">
            {syncing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Syncing from Jobber…</>
            ) : (
              <><Download className="w-4 h-4 mr-2" />Sync from Jobber now</>
            )}
          </Button>
          {lastSync && (
            <div className="text-xs text-muted-foreground">Last sync: {lastSync}</div>
          )}
        </Card>
      )}

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Jobber?</AlertDialogTitle>
            <AlertDialogDescription>
              TreeCheck stops syncing with Jobber, and Jobber removes TreeCheck from your connected apps.
              Nothing already in TreeCheck or Jobber is deleted. You can connect again any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void disconnect()}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
