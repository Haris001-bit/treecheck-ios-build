// Financial Pulse: the owner's screen (route /dashboard/pulse).
// Owners who have not finished setup are sent to setup. Numbers come from pulse-get; when it says a
// background refresh is running, the page asks once more a little later, and while the first numbers
// are still arriving (a bank's past months, Jobber's jobs) it keeps asking every 20 s for 10 minutes, then
// every minute. A later read that fails keeps the last numbers and says so, with Try again.
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import PulseGate from "@/components/pulse/PulseGate";
import NativeLinkNotice from "@/components/pulse/NativeLinkNotice";
import { PulseScreen } from "@/components/pulse/screen/PulseScreen";
import { stillArriving } from "@/components/pulse/screen/pulseScreenTypes";
import { usePulseAccess } from "@/hooks/pulse/usePulseAccess";
import { pulseGet } from "@/lib/pulse/api";
import { pulseSetupAllowed } from "@/lib/pulse/flags";
import { createPulseDataSource } from "@/lib/pulse/pulseDataSource";

const RECHECK_MS = 20_000;
const ARRIVING_POLL_MS = 20_000;
const ARRIVING_POLL_FOR_MS = 10 * 60_000;
// After the first 10 minutes, keep asking every minute while numbers still arrive: these calls are what
// move a long Jobber import forward (pulse-get does the work after replying).
const ARRIVING_POLL_SLOW_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function PulseHomeInner() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { ownerId } = usePulseAccess();

  const info = useQuery({
    queryKey: ["pulse", ownerId, "home-info"],
    enabled: !!ownerId,
    queryFn: async () => {
      const [s, p, c] = await Promise.all([
        db.from("pulse_settings").select("setup_completed_at, timezone").eq("owner_id", ownerId).maybeSingle(),
        db.from("profiles").select("company_name, full_name").eq("id", ownerId).maybeSingle(),
        db.from("pulse_categories").select("key, label").eq("owner_id", ownerId).eq("active", true),
      ]);
      if (s.error) throw new Error(s.error.message);
      const labels: Record<string, string> = {};
      for (const row of (c.data ?? []) as Array<{ key: string; label: string }>) labels[row.key] = row.label;
      return {
        setupDone: !!s.data?.setup_completed_at,
        timezone: (s.data?.timezone as string | null) || "America/Chicago",
        company: (p.data?.company_name as string | null) || (p.data?.full_name as string | null) || "Your company",
        labels,
      };
    },
  });

  const openedAt = useRef(Date.now());
  const numbers = useQuery({
    queryKey: ["pulse", ownerId, "numbers"],
    enabled: !!ownerId && info.data?.setupDone === true,
    queryFn: async () => {
      const r = await pulseGet();
      if (r.ok === false) throw new Error(r.error);
      return r;
    },
    // First numbers still arriving: keep asking (pulse-get only works them out again once marked changed).
    refetchInterval: (q) => {
      const snap = q.state.data?.snapshot;
      if (!snap || !stillArriving(snap)) return false;
      return Date.now() - openedAt.current < ARRIVING_POLL_FOR_MS ? ARRIVING_POLL_MS : ARRIVING_POLL_SLOW_MS;
    },
  });

  // Ask once more after a background refresh, so new bank or Jobber data shows up.
  const rechecked = useRef(false);
  useEffect(() => {
    if (!numbers.data?.refreshing || rechecked.current) return;
    rechecked.current = true;
    const t = setTimeout(() => { void qc.invalidateQueries({ queryKey: ["pulse", ownerId, "numbers"] }); }, RECHECK_MS);
    return () => clearTimeout(t);
  }, [numbers.data?.refreshing, ownerId, qc]);

  // "Updating your numbers" only for reloads the owner caused (not the background checks).
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    if (changing && !numbers.isFetching) setChanging(false);
  }, [changing, numbers.isFetching]);

  const data = useMemo(
    () => (ownerId && info.data ? createPulseDataSource(ownerId, info.data.timezone) : null),
    [ownerId, info.data],
  );

  if (info.isLoading || (info.data?.setupDone && numbers.isLoading)) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground" aria-busy="true">
        <Loader2 className="w-5 h-5 animate-spin" /> Working out your numbers...
      </div>
    );
  }
  // Not set up yet: setup happens on the website (in the phone apps, a notice says so).
  if (info.data && !info.data.setupDone) {
    return pulseSetupAllowed()
      ? <Navigate to="/dashboard/pulse/setup" replace />
      : <NativeLinkNotice reason="setup" onCheckAgain={() => { void info.refetch(); }} />;
  }
  // A failed background read keeps the last numbers on screen; only a first load that failed shows this.
  if (!numbers.data || !data || !info.data) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 space-y-3">
          <p className="font-bold">Couldn't load your numbers.</p>
          <p className="text-sm text-muted-foreground">{(numbers.error as Error | null)?.message ?? "Please try again."}</p>
          <Button variant="outline" onClick={() => { void info.refetch(); void numbers.refetch(); }}>Try again</Button>
        </Card>
      </div>
    );
  }

  return (
    <PulseScreen
      snapshot={numbers.data.snapshot}
      companyName={info.data.company}
      categoryLabels={info.data.labels}
      data={data}
      refreshing={numbers.data.refreshing && !rechecked.current}
      updating={changing && numbers.isFetching}
      refreshFailed={numbers.isRefetchError}
      onRetry={() => { setChanging(true); void numbers.refetch(); }}
      jobberImport={numbers.data.jobber_import}
      onReconnect={() => navigate("/dashboard/pulse/setup?section=banks")}
      onOpenSetup={(section) => navigate(section ? `/dashboard/pulse/setup?section=${section}` : "/dashboard/pulse/setup")}
      onOpenTransactions={() => navigate("/dashboard/pulse/transactions")}
      onChanged={() => { setChanging(true); void qc.invalidateQueries({ queryKey: ["pulse", ownerId, "numbers"] }); }}
    />
  );
}

export default function PulseHome() {
  return (
    <PulseGate>
      <PulseHomeInner />
    </PulseGate>
  );
}
