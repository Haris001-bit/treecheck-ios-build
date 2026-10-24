// Financial Pulse setup page (route /dashboard/pulse/setup).
// Loads the owner's Jobber connection, banks, accounts and settings, and wires the wizard (and the
// settings page it becomes after setup) to the live backend. Jobber's past jobs start coming in the
// moment Jobber connects, so the first numbers have the sales in them.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PulseGate from "@/components/pulse/PulseGate";
import { PulseSetupOnWebsite } from "@/components/pulse/NativeLinkNotice";
import PlaidLinkButton from "@/components/pulse/PlaidLinkButton";
import { PulseSetupWizard, type JobberNotice } from "@/components/pulse/setup/PulseSetupWizard";
import {
  isSetupSection,
  isStepKey,
  type JobberImport,
  jobberErrorText,
  PAY_FREQUENCIES,
  type PayFrequency,
  type SetupAccount,
  type SetupActions,
  type SetupBank,
  type SetupSection,
  type SetupState,
  type StepKey,
} from "@/components/pulse/setup/setupModel";
import { PULSE_ACCESS_QUERY_KEY, usePulseAccess } from "@/hooks/pulse/usePulseAccess";
import { pulseErrorMessage, setup, sync } from "@/lib/pulse/api";
import { pulseSetupAllowed } from "@/lib/pulse/flags";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const ACCOUNT_COLUMNS =
  "id, item_row_id, name, mask, type, subtype, is_business, include_from, use_for_payroll, status, count_from_confirmed_at, created_at";
// Bringing in Jobber's past jobs: each call works for up to about 45 s; stop after this many calls
// (pulse-get's background refresh carries on from where this stopped). A dropped request (a phone
// switching apps) is tried again a few times before the page gives up. A failure the server answered is
// not tried again here: the server counts failed tries (three in a row show as a problem), and quick
// retries would reach that count in a minute; pulse-get's refreshes, minutes apart, carry on instead.
const JOBBER_IMPORT_MAX_CALLS = 40;
const JOBBER_IMPORT_RETRIES = 3;

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function loadSetupState(ownerId: string): Promise<SetupState> {
  const [items, accounts, settings, jobber] = await Promise.all([
    db.from("plaid_items")
      .select("id, institution_name, status, new_accounts_available, last_successful_update, linked_at")
      .eq("owner_id", ownerId).neq("status", "removed").order("linked_at", { ascending: true }),
    db.from("plaid_accounts").select(ACCOUNT_COLUMNS).eq("owner_id", ownerId).order("name", { ascending: true }),
    db.from("pulse_settings")
      .select("pay_frequency, pay_anchor_date, payroll_amount_override, profit_target_monthly, cash_reserve, setup_step, setup_completed_at, timezone")
      .eq("owner_id", ownerId).maybeSingle(),
    // Only whether a connection exists and its account name; never the tokens.
    db.from("jobber_tokens").select("id, disconnected_at, account_name").eq("contractor_id", ownerId).maybeSingle(),
  ]);
  if (items.error) throw new Error("pulse_items_failed");
  if (accounts.error) throw new Error("pulse_accounts_failed");
  if (settings.error) throw new Error("pulse_settings_failed");
  // A failed read must not look like "Jobber not connected" (the wizard would send the owner back to it).
  if (jobber.error) throw new Error("pulse_jobber_failed");
  const banks = (items.data ?? []) as SetupBank[];
  const bankIds = new Set(banks.map((b) => b.id));
  const s = (settings.data ?? {}) as Record<string, unknown>;
  const freq = (PAY_FREQUENCIES as readonly string[]).includes(String(s.pay_frequency)) ? (s.pay_frequency as PayFrequency) : null;
  const connected = !!jobber.data && !jobber.data.disconnected_at;
  return {
    jobberConnected: connected,
    jobberAccountName: connected ? ((jobber.data.account_name as string | null) ?? null) : null,
    banks,
    accounts: ((accounts.data ?? []) as SetupAccount[])
      .filter((a) => bankIds.has(a.item_row_id))
      .map((a) => ({ ...a, count_from_confirmed_at: a.count_from_confirmed_at ?? null, created_at: a.created_at ?? null })),
    settings: {
      pay_frequency: freq,
      pay_anchor_date: (s.pay_anchor_date as string | null) ?? null,
      payroll_amount_override: num(s.payroll_amount_override),
      profit_target_monthly: num(s.profit_target_monthly),
      cash_reserve: num(s.cash_reserve),
      setup_step: (s.setup_step as string | null) ?? null,
      setup_completed_at: (s.setup_completed_at as string | null) ?? null,
      timezone: (s.timezone as string | null) ?? null,
    },
  };
}

/** Waits until the page comes back from Jobber's login with the browser's Back button (then it can be used again). */
function untilPageShownAgain(maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener("pageshow", onShow); clearTimeout(timer); resolve(); };
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) done(); };
    const timer = setTimeout(done, maxMs);
    window.addEventListener("pageshow", onShow);
  });
}

export default function PulseSetup() {
  return (
    <PulseGate>
      {/* In the phone apps, setup and settings stay on the website (they open Plaid's and Jobber's windows). */}
      {pulseSetupAllowed() ? <PulseSetupContent /> : <PulseSetupOnWebsite />}
    </PulseGate>
  );
}

function PulseSetupContent() {
  const { ownerId } = usePulseAccess();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  // Read once: where Jobber sent the owner back to and what it said, and which section to open at;
  // then tidy the address bar.
  const [entry] = useState(() => {
    const step = params.get("step");
    const section = params.get("section");
    const error = jobberErrorText(params.get("jobber_error"));
    return {
      step: isStepKey(step) ? (step as StepKey) : undefined,
      notice: params.get("connected") === "1" ? ({ kind: "connected" } as JobberNotice)
        : error ? ({ kind: "error", message: error } as JobberNotice) : null,
      section: isSetupSection(section) ? (section as SetupSection) : step === "jobber" ? ("jobber" as const) : null,
    };
  });
  useEffect(() => {
    if (entry.notice?.kind === "connected") toast.success("Jobber connected.");
    if (params.toString()) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const key = useMemo(() => ["pulse", ownerId, "setup-state"], [ownerId]);
  const state = useQuery({ queryKey: key, enabled: !!ownerId, queryFn: () => loadSetupState(ownerId as string) });
  const setupDone = !!state.data?.settings.setup_completed_at;

  // Jobber's past jobs: start bringing them in as soon as Jobber is connected (during setup, or right
  // after connecting from the settings page), so the first numbers have the sales in them.
  const [jobberImport, setJobberImport] = useState<JobberImport>({ state: "idle", jobs: 0 });
  const importWanted = !!state.data?.jobberConnected && (!setupDone || entry.notice?.kind === "connected");
  useEffect(() => {
    if (!importWanted) return;
    let live = true;
    (async () => {
      setJobberImport({ state: "running", jobs: 0 });
      let jobsSoFar = 0;
      let retries = 0;
      for (let i = 0; i < JOBBER_IMPORT_MAX_CALLS && live; i++) {
        const { data, error } = await supabase.functions.invoke("jobber-revenue-sync", { body: { mode: "backfill" } });
        if (!live) return;
        const body = (data ?? {}) as { ok?: boolean; done?: boolean; jobs_seen?: number; code?: string };
        if (error || body.ok !== true) {
          if (body.code === "jobber_not_connected") { setJobberImport({ state: "idle", jobs: 0 }); return; }
          // No answer at all (a dropped request): wait and try again a few times.
          const noAnswer = !!error && !(error instanceof FunctionsHttpError);
          if (noAnswer && retries < JOBBER_IMPORT_RETRIES) {
            retries++;
            await new Promise((res) => setTimeout(res, 2000 * 2 ** retries));
            continue;
          }
          setJobberImport({
            state: "failed",
            jobs: jobsSoFar,
            reconnect: body.code === "jobber_reconnect",
            message: body.code === "jobber_reconnect"
              ? "Jobber asked you to sign in again. Press Reconnect Jobber."
              : "Your jobs will finish coming in when you open Financial Pulse.",
          });
          return;
        }
        retries = 0;
        const jobs = typeof body.jobs_seen === "number" ? body.jobs_seen : 0;
        jobsSoFar = jobs;
        if (body.done) {
          setJobberImport({ state: "done", jobs });
          void qc.invalidateQueries({ queryKey: ["pulse", ownerId, "numbers"] });
          return;
        }
        setJobberImport({ state: "running", jobs });
        await new Promise((res) => setTimeout(res, 1000));
      }
      // Still not done after this page's share of the work: the rest carries on from the Pulse screen.
      if (live) setJobberImport({ state: "continuing", jobs: jobsSoFar });
    })();
    return () => { live = false; };
  }, [importWanted, ownerId, qc]);

  const actions: SetupActions = useMemo(() => ({
    async connectJobber() {
      const { data, error } = await supabase.functions.invoke("jobber-connect", {
        body: { return_to: `${window.location.origin}/dashboard/pulse/setup?step=jobber` },
      });
      if (error) throw new Error("Couldn't start the Jobber connection. Please try again.");
      if (data?.error) throw new Error(String(data.error));
      if (!data?.authorize_url) throw new Error("Couldn't start the Jobber connection. Please try again.");
      // Jobber's login page can't be shown inside another page (Lovable's preview): use a new tab there.
      if (window.self !== window.top) {
        window.open(data.authorize_url, "_blank", "noopener,noreferrer");
        toast.info("Continue in the new tab, then come back and refresh this page.");
        return;
      }
      window.location.href = data.authorize_url;
      // Leaving for Jobber. If the owner comes back with the Back button, the page is usable again.
      await untilPageShownAgain(20_000);
    },
    async saveAccounts(accounts) {
      const res = await setup({ action: "set_accounts", accounts });
      if (res.ok === false) throw new Error(pulseErrorMessage(res));
      const done = !!(qc.getQueryData(key) as SetupState | undefined)?.settings.setup_completed_at;
      if (done) {
        // After setup: bring in the latest (and any re-pulled history) in the background, then let an
        // open Pulse screen ask again. During setup the first sync already ran when the bank was linked.
        void sync({}).then((r) => {
          if (r.ok === false) toast.error(pulseErrorMessage(r));
          else if (r.problems.includes("login_required")) toast.error("One of your banks needs you to log in. Press Reconnect on it.");
          void qc.invalidateQueries({ queryKey: ["pulse", ownerId, "numbers"] });
        });
      }
      return { historyRepull: res.ok === true && "history_repull" in res && res.history_repull === true };
    },
    async saveSettings(patch) {
      const res = await setup({ action: "save_settings", settings: patch });
      if (res.ok === false) throw new Error(pulseErrorMessage(res));
    },
    async complete() {
      const res = await setup({ action: "complete" });
      if (res.ok === false) {
        // The server may have finished setup before a later step failed: then carry on.
        const fresh = await loadSetupState(ownerId as string).catch(() => null);
        if (!fresh?.settings.setup_completed_at) throw new Error(pulseErrorMessage(res));
      }
      // The Pulse screen must not see the old "setup not finished" answer.
      qc.removeQueries({ queryKey: ["pulse", ownerId, "home-info"] });
      await qc.invalidateQueries({ queryKey: ["pulse", ownerId] });
    },
    async refresh() {
      // Everything Pulse shows for this company (setup, transactions labels, the numbers). The state just
      // read comes back from the cache: the page itself only shows it a moment later.
      await qc.invalidateQueries({ queryKey: ["pulse", ownerId] });
      return (qc.getQueryData(key) as SetupState | undefined) ?? null;
    },
  }), [key, ownerId, qc]);

  if (state.isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground" aria-busy="true">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading your setup...
      </div>
    );
  }
  // A failed re-read keeps what is on screen; only a first load that failed shows this.
  if (!state.data) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <Card className="p-6 space-y-3">
          <p className="font-bold">Couldn't load your setup.</p>
          <Button variant="outline" onClick={() => void state.refetch()}>Try again</Button>
        </Card>
      </div>
    );
  }

  return (
    <PulseSetupWizard
      state={state.data}
      actions={actions}
      LinkButton={PlaidLinkButton}
      initialStep={entry.step}
      jobberNotice={entry.notice}
      focusSection={entry.section}
      jobberImport={jobberImport}
      onOpenPulse={() => navigate("/dashboard/pulse")}
      onLinkFailure={(f) => {
        if (f.code === "not_enabled") void qc.invalidateQueries({ queryKey: [PULSE_ACCESS_QUERY_KEY] });
      }}
    />
  );
}
