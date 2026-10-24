// Financial Pulse setup (A12, A15): a six-step wizard for a new company, and the same pieces as a
// settings page once setup is finished (Jobber, banks, business accounts, payroll and goal).
// Every step saves where the owner is, so they can stop and come back.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Info,
  Landmark,
  LineChart,
  Loader2,
  Plus,
  Users,
  Wallet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { PlaidLinkedResult } from "@/components/pulse/PlaidLinkButton";
import { afterUpdateOutcome, pulseErrorMessage, type PulseFailure } from "@/lib/pulse/api";
import { WARN_BORDER, WARN_ICON, WARN_PANEL } from "../tone";
import {
  AccountRowEditor,
  BankRow,
  ConsentBox,
  DoneLine,
  type LinkButtonComponent,
  type PayrollErrorKey,
  PayrollGoalForm,
  type PayrollGoalValue,
} from "./SetupParts";
import {
  accountName,
  accountPayload,
  anchorFromSchedule,
  browserTimezone,
  type Draft,
  forConnectedJobber,
  formatDay,
  formatWeekday,
  isBankAccount,
  isCreditCard,
  isNewAccount,
  type JobberImport,
  moneyText,
  needsCountChoice,
  nextDraft,
  openingStep,
  parseMoney,
  sameDraft,
  scheduleFromSettings,
  scheduleText,
  serverDraft,
  type SettingsPatch,
  type SetupAccount,
  type SetupActions,
  type SetupSection,
  type SetupState,
  STEP_TITLE,
  type StepKey,
  STEPS,
  todayLocal,
  upcomingPaydays,
} from "./setupModel";

export interface JobberNotice {
  kind: "connected" | "error";
  message?: string;
}

export interface PulseSetupWizardProps {
  state: SetupState;
  actions: SetupActions;
  /** The Plaid Link button (the real one in the app, a stand-in in the design preview). */
  LinkButton: LinkButtonComponent;
  /** Where to start (the Jobber step after Jobber sends the owner back); otherwise where they left off. */
  initialStep?: StepKey;
  /** What Jobber said when it sent the owner back. */
  jobberNotice?: JobberNotice | null;
  /** Settings page: the section to open at (from "Open setup" and Reconnect buttons). */
  focusSection?: SetupSection | null;
  /** Jobber's past jobs coming in, from the moment Jobber connects. */
  jobberImport?: JobberImport;
  /** Setup finished: go to the Pulse screen. */
  onOpenPulse: () => void;
  /** A refusal from Plaid's button (also shown on the page). */
  onLinkFailure?: (failure: PulseFailure) => void;
}

export function PulseSetupWizard(props: PulseSetupWizardProps) {
  return props.state.settings.setup_completed_at ? <SettingsPage {...props} /> : <Wizard {...props} />;
}

// ---------------------------------------------------------------------------
// Shared state: account choices, payroll and goal, Plaid link results

function useAccountDrafts(accounts: SetupAccount[]) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftFor = (a: SetupAccount): Draft => drafts[a.id] ?? serverDraft(a);
  const update = (a: SetupAccount, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const next = nextDraft(a, prev[a.id] ?? serverDraft(a), patch);
      const copy = { ...prev };
      if (sameDraft(next, serverDraft(a))) delete copy[a.id];
      else copy[a.id] = next;
      return copy;
    });
  };
  const dirty = Object.keys(drafts).length > 0;
  const missingChoice = accounts.some((a) => needsCountChoice(a, draftFor(a)));
  const anyBusiness = accounts.some((a) => draftFor(a).is_business);
  return { draftFor, update, dirty, missingChoice, anyBusiness, reset: () => setDrafts({}) };
}

/** The bank accounts that can pay payroll now: business, bank (not card), still shared by the bank. */
function payrollBanks(state: SetupState): SetupAccount[] {
  return state.accounts.filter((a) => a.is_business && isBankAccount(a) && a.status === "active");
}

/**
 * The payroll answers as saved. preselect: during setup an only business bank account is ticked to
 * save the owner a tap; the settings page shows exactly what is saved, so a missing account is visible.
 */
function payrollFromState(state: SetupState, preselect: boolean): PayrollGoalValue {
  const s = state.settings;
  const banks = payrollBanks(state);
  const chosen = banks.filter((a) => a.use_for_payroll).map((a) => a.id);
  const answeredNo = !s.pay_frequency && chosen.length === 0 && (s.setup_step === "finish" || !!s.setup_completed_at);
  return {
    runsPayroll: answeredNo ? "no" : "yes",
    payrollAccountIds: chosen.length > 0 ? chosen : preselect && banks.length === 1 ? [banks[0].id] : [],
    ...scheduleFromSettings(s.pay_frequency, s.pay_anchor_date, todayLocal()),
    typicalPayroll: moneyText(s.payroll_amount_override),
    profitGoal: moneyText(s.profit_target_monthly),
    cashReserve: s.cash_reserve ? moneyText(s.cash_reserve) : "",
  };
}

/** Problems with the payroll answers; only accounts that can pay payroll now count. */
function payrollErrors(v: PayrollGoalValue, payrollBankIds: string[]): Partial<Record<PayrollErrorKey, string>> {
  const e: Partial<Record<PayrollErrorKey, string>> = {};
  const bad = "Type an amount in dollars, like 1,500.";
  if (v.runsPayroll === "yes") {
    if (!v.payrollAccountIds.some((id) => payrollBankIds.includes(id))) e.accounts = "Tick the account payroll comes out of.";
    if (!v.frequency) e.frequency = "Choose how often you pay.";
    else if (!anchorFromSchedule(v, todayLocal())) {
      e.schedule = v.frequency === "semimonthly" ? "Choose which days you pay."
        : v.frequency === "monthly" ? "Choose the day of the month you pay." : "Pick your next payday.";
    }
    if (Number.isNaN(parseMoney(v.typicalPayroll))) e.typicalPayroll = bad;
    if (Number.isNaN(parseMoney(v.cashReserve))) e.cashReserve = bad;
  }
  if (Number.isNaN(parseMoney(v.profitGoal))) e.profitGoal = bad;
  return e;
}

/**
 * Saves payroll and goal: which accounts pay payroll (only if that changed), then the settings. Every
 * account follows the answers on screen; one the bank no longer shares isn't offered, so it stops paying.
 */
async function savePayroll(state: SetupState, actions: SetupActions, v: PayrollGoalValue, extra: SettingsPatch = {}) {
  const yes = v.runsPayroll === "yes";
  const wanted = (a: SetupAccount) =>
    yes && a.is_business && isBankAccount(a) && a.status === "active" && v.payrollAccountIds.includes(a.id);
  if (state.accounts.some((a) => a.use_for_payroll !== wanted(a))) {
    await actions.saveAccounts(accountPayload(state.accounts, (a) => ({ ...serverDraft(a), use_for_payroll: wanted(a) })));
  }
  await actions.saveSettings({
    pay_frequency: yes ? v.frequency : null,
    pay_anchor_date: yes ? anchorFromSchedule(v, todayLocal()) : null,
    payroll_amount_override: yes ? parseMoney(v.typicalPayroll) : null,
    profit_target_monthly: parseMoney(v.profitGoal),
    cash_reserve: yes ? parseMoney(v.cashReserve) ?? 0 : 0,
    ...extra,
  });
}

/**
 * Plaid link results. onAccountsArrived gets the banks and accounts as just read again after a new bank
 * or an "Add accounts" (Plaid's account picker), so the page can point at accounts to turn on.
 */
/** After a new bank or Add accounts, how long to keep reading until its new accounts are stored. */
const ARRIVAL_POLL_MS = 3000;
const ARRIVAL_TRIES = 10;

function useLinkHandlers(
  actions: SetupActions,
  opts: {
    onLinkFailure?: (f: PulseFailure) => void;
    onAccountsArrived?: (fresh: SetupState | null) => void;
    /** The accounts on the page before Plaid's window opened (to tell which ones are new). */
    knownAccountIds?: () => string[];
  } = {},
) {
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  // The sync after Plaid's window can find the bank busy with the sync Plaid's own webhook started, and
  // reply before the new accounts are stored: read again every 3 s (up to 30 s) until they are there.
  const whenAccountsArrive = (itemRowId: string, reread: Promise<SetupState | null>) => {
    if (!opts.onAccountsArrived) return;
    const before = new Set(opts.knownAccountIds?.() ?? []);
    const arrived = (fresh: SetupState | null) =>
      (fresh?.accounts ?? []).some((a) => a.item_row_id === itemRowId && !before.has(a.id));
    void (async () => {
      let fresh = await reread.catch(() => null);
      for (let i = 0; i < ARRIVAL_TRIES && !arrived(fresh); i++) {
        await new Promise((res) => setTimeout(res, ARRIVAL_POLL_MS));
        fresh = await actions.refresh().catch(() => fresh);
      }
      opts.onAccountsArrived?.(fresh);
    })();
  };
  const onLinked = (result: PlaidLinkedResult) => {
    setLinkMessage(null);
    const reread = actions.refresh();
    if (result.mode === "new") {
      toast.success("Bank linked. Next, choose which of its accounts are for the business.");
      whenAccountsArrive(result.itemRowId, reread);
      return;
    }
    const outcome = afterUpdateOutcome(result.sync);
    if (outcome.ok) toast.success(outcome.message);
    else toast.error(outcome.message);
    if (result.sync.ok === false && result.sync.code === "not_enabled") opts.onLinkFailure?.(result.sync);
    else if (result.accountSelection) whenAccountsArrive(result.itemRowId, reread);
  };
  const onFailure = (failure: PulseFailure) => {
    setLinkMessage(pulseErrorMessage(failure));
    // A link whose reply was lost may still have gone through: read the banks again.
    void actions.refresh();
    opts.onLinkFailure?.(failure);
  };
  return { linkMessage, onLinked, onFailure };
}

function errorText(e: unknown): string {
  return (e as Error)?.message || "Something went wrong. Please try again.";
}

/** "Connected to Sample Tree Co." (no second full stop when the name ends with one). */
function connectedTo(name: string | null): string {
  if (!name) return "Jobber is connected.";
  return `Connected to ${name}${name.endsWith(".") ? "" : "."}`;
}

/** "Bringing in your jobs (340 so far)..." and the like, for the Jobber lines. */
function importText(imp: JobberImport | undefined): string | null {
  if (!imp || imp.state === "idle") return null;
  if (imp.state === "running") return imp.jobs > 0 ? `Bringing in your jobs (${imp.jobs.toLocaleString("en-US")} so far)...` : "Bringing in your jobs...";
  if (imp.state === "done") return imp.jobs > 0 ? `All ${imp.jobs.toLocaleString("en-US")} jobs are in.` : "Your jobs are in.";
  if (imp.state === "continuing") return "The rest of your jobs come in when you open Financial Pulse.";
  return imp.message ?? "Your jobs will finish coming in when you open Financial Pulse.";
}

/** Phones have TreeCheck's fixed 64 px bar on top: scrolled-to things land below it. */
const SCROLL_MARGIN = "scroll-mt-20 lg:scroll-mt-4";

// ---------------------------------------------------------------------------
// The wizard

function Wizard({ state, actions, LinkButton, initialStep, jobberNotice, jobberImport, onOpenPulse, onLinkFailure }: PulseSetupWizardProps) {
  const [step, setStep] = useState<StepKey>(() => openingStep(state, initialStep));
  // Permission is given in this visit: at Start, or on the bank step for an owner who came back later.
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const accounts = useAccountDrafts(state.accounts);
  const [payroll, setPayroll] = useState<PayrollGoalValue>(() => payrollFromState(state, true));
  const link = useLinkHandlers(actions, { onLinkFailure });
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // The payroll step offers the business bank accounts saved as business; one is ticked for the owner.
  const banks = payrollBanks(state);
  useEffect(() => {
    setPayroll((p) => (p.payrollAccountIds.length === 0 && banks.length === 1 ? { ...p, payrollAccountIds: [banks[0].id] } : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks.length]);

  // A new step: read the accounts again when they are needed, and move focus to the step's title so a
  // screen reader announces it.
  useEffect(() => {
    if (step === "accounts") void actions.refresh();
    if (moved.current) heading.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const index = STEPS.indexOf(step);
  // Step saves go one after another: two quick taps must never leave the older step saved last.
  const stepSaves = useRef<Promise<void>>(Promise.resolve());
  const go = (next: StepKey, extra: SettingsPatch = {}) => {
    setShowErrors(false);
    moved.current = true;
    setStep(next);
    // Where the owner is, so they can come back to it (best effort).
    stepSaves.current = stepSaves.current
      .then(() => actions.saveSettings({ setup_step: next, ...extra }))
      .catch(() => { /* not critical */ });
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const back = () => go(STEPS[Math.max(0, index - 1)]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const pErrors = payrollErrors(payroll, banks.map((a) => a.id));

  let body: ReactNode;
  let next: { label: string; disabled?: boolean; hint?: string | null; onClick: () => void } | null = null;

  if (step === "start") {
    body = <StartStep consented={consented} onConsent={setConsented} />;
    next = {
      label: "Start",
      disabled: !consented,
      hint: consented ? null : "Tick \"I agree\" to start.",
      onClick: () => {
        const tz = browserTimezone();
        go("jobber", tz && !state.settings.setup_step ? { timezone: tz } : {});
      },
    };
  } else if (step === "jobber") {
    body = (
      <JobberStep
        connected={state.jobberConnected}
        accountName={state.jobberAccountName}
        notice={jobberNotice}
        importing={jobberImport}
        busy={busy}
        onConnect={() => run(() => actions.connectJobber())}
      />
    );
    next = state.jobberConnected ? { label: "Continue", onClick: () => go("banks") } : null;
  } else if (step === "banks") {
    body = <BanksStep state={state} LinkButton={LinkButton} link={link} consented={consented} onConsent={setConsented} />;
    next = {
      label: "Continue",
      disabled: state.banks.length === 0,
      hint: state.banks.length === 0 ? "Link at least one bank to continue." : null,
      onClick: () => go("accounts"),
    };
  } else if (step === "accounts") {
    body = <AccountsStep state={state} drafts={accounts} disabled={busy} onRefresh={actions.refresh} />;
    const blocked = !accounts.anyBusiness
      ? "Turn on at least one business account."
      : accounts.missingChoice ? "Answer the question under each business card." : null;
    next = {
      label: busy ? "Saving..." : "Save and continue",
      disabled: busy || !!blocked,
      hint: blocked,
      onClick: () => run(async () => {
        if (accounts.dirty || !state.accounts.some((a) => a.count_from_confirmed_at !== null || a.is_business)) {
          await actions.saveAccounts(accountPayload(state.accounts, accounts.draftFor));
          await actions.refresh();
          accounts.reset();
        }
        go("payroll");
      }),
    };
  } else if (step === "payroll") {
    body = (
      <PayrollGoalForm
        value={payroll}
        onChange={(patch) => setPayroll((p) => ({ ...p, ...patch }))}
        bankAccounts={banks}
        showErrors={showErrors}
        errors={pErrors}
        disabled={busy}
      />
    );
    next = {
      label: busy ? "Saving..." : "Save and continue",
      disabled: busy,
      hint: showErrors && Object.keys(pErrors).length > 0 ? "Fix the items marked in red." : null,
      onClick: () => {
        if (Object.keys(pErrors).length > 0) {
          setShowErrors(true);
          return;
        }
        void run(async () => {
          await savePayroll(state, actions, payroll, { setup_step: "finish" });
          await actions.refresh();
          go("finish");
        });
      },
    };
  } else {
    body = <FinishStep state={state} jobberImport={jobberImport} onEdit={(s) => go(s)} />;
    next = {
      label: busy ? "Finishing..." : "Finish and see my numbers",
      disabled: busy,
      onClick: () => run(async () => {
        // A step save still on its way must not land after "complete".
        await stepSaves.current;
        await actions.complete();
        toast.success("Setup finished.");
        onOpenPulse();
      }),
    };
  }

  return (
    <div ref={top} className={cn("p-4 sm:p-6 max-w-2xl mx-auto space-y-4", SCROLL_MARGIN)}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LineChart className="w-6 h-6 text-primary shrink-0" /> Set up Financial Pulse
        </h1>
        <p className="text-sm text-muted-foreground mt-1">About 10 minutes. Your progress is saved, so you can stop and come back.</p>
      </div>

      <StepProgress current={index} />

      <Card className="p-5 sm:p-6 space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Step {index + 1} of {STEPS.length}</p>
          <h2 ref={heading} tabIndex={-1} className="text-xl font-black mt-0.5 outline-none">{STEP_TITLE[step]}</h2>
        </div>
        {body}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-border">
          {index > 0 ? (
            <Button variant="ghost" onClick={back} disabled={busy} className="sm:w-auto">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
          ) : <span className="hidden sm:block" />}
          {next && (
            <div className="flex flex-col sm:items-end gap-1.5">
              <Button onClick={next.onClick} disabled={next.disabled} className="w-full sm:w-auto" data-pulse-next>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {next.label}
                {!busy && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
              {next.hint && <p className="text-xs text-muted-foreground">{next.hint}</p>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function StepProgress({ current }: { current: number }) {
  return (
    <ol className="grid grid-cols-6 gap-1.5" aria-label={`Setup steps: step ${current + 1} of ${STEPS.length}, ${STEP_TITLE[STEPS[current]]}`}>
      {STEPS.map((s, i) => (
        <li key={s} className="space-y-1.5" aria-current={i === current ? "step" : undefined}>
          <div className={cn("h-1.5 rounded-full", i <= current ? "bg-primary" : "bg-muted")} />
          <p className={cn("hidden sm:block text-[11px] leading-tight", i === current ? "font-bold text-foreground" : "text-muted-foreground")}>
            {STEP_TITLE[s]}
          </p>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Steps

function StartStep({ consented, onConsent }: { consented: boolean; onConsent: (v: boolean) => void }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Financial Pulse puts your sales from Jobber next to what you spend from your business bank and card. You see
        your profit this month, where the month is heading, and whether payroll is covered.
      </p>
      <div className="space-y-2">
        <p className="text-sm font-bold">You'll need</p>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2"><Users className="w-4 h-4 text-primary shrink-0" /> Your Jobber login (the company's Jobber account)</li>
          <li className="flex items-center gap-2"><Landmark className="w-4 h-4 text-primary shrink-0" /> Your business bank login, and your card's if it's at another bank</li>
          <li className="flex items-center gap-2"><Wallet className="w-4 h-4 text-primary shrink-0" /> When you pay your crew</li>
        </ul>
      </div>
      <ConsentBox id="pulse-consent" checked={consented} onChange={onConsent} />
    </div>
  );
}

/**
 * What Jobber said when it sent the owner back with an error. Not connected: in red. Still connected
 * (a Reconnect that didn't go through): the same message, plain, worded for the Reconnect button.
 */
function JobberNoticeAlert({ notice, connected }: { notice?: JobberNotice | null; connected: boolean }) {
  if (notice?.kind !== "error") return null;
  const message = notice.message || "Jobber didn't connect. Please press Connect Jobber to try again.";
  return connected ? (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertDescription data-pulse-jobber-notice>{forConnectedJobber(message)}</AlertDescription>
    </Alert>
  ) : (
    <Alert variant="destructive" className="bg-background">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription data-pulse-jobber-notice>{message}</AlertDescription>
    </Alert>
  );
}

/** What to know before pressing Connect Jobber (carried over from TreeCheck's Jobber page). */
function JobberTips() {
  return (
    <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
      <li>Sign in with your company's Jobber account, not a Jobber developer login.</li>
      <li>You need to be the owner or an admin of that Jobber account.</li>
      <li>Jobber's login page opens, then brings you back here.</li>
    </ul>
  );
}

function JobberStep({
  connected, accountName: jobberName, notice, importing, busy, onConnect,
}: {
  connected: boolean; accountName: string | null; notice?: JobberNotice | null; importing?: JobberImport; busy: boolean; onConnect: () => void;
}) {
  const progress = importText(importing);
  const failed = importing?.state === "failed";
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Financial Pulse counts your sales from Jobber: the payments you record there, or the jobs you mark complete if you don't record payments. Connecting Jobber is required.</p>
      <JobberNoticeAlert notice={notice} connected={connected} />
      {connected ? (
        <div className="space-y-3">
          <div className={cn("rounded-lg border p-4 space-y-1", failed ? cn(WARN_BORDER, WARN_PANEL) : "border-primary/30 bg-primary/5")}>
            <p className="flex items-center gap-2 text-sm font-bold">
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
              {connectedTo(jobberName)}
            </p>
            {progress && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 pl-7" data-pulse-jobber-import>
                {importing?.state === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
                {failed && <AlertTriangle className={cn("w-3 h-3", WARN_ICON)} />}
                {progress}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Button variant="outline" size="sm" onClick={onConnect} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reconnect Jobber
            </Button>
            <p className="text-xs text-muted-foreground">Use this if Jobber asks you to sign in again, or if this isn't your company's Jobber account.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Button onClick={onConnect} disabled={busy} className="w-full sm:w-auto" data-pulse-connect-jobber>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Connect Jobber
          </Button>
          <JobberTips />
        </div>
      )}
    </div>
  );
}

function BanksStep({
  state, LinkButton, link, consented, onConsent,
}: {
  state: SetupState; LinkButton: LinkButtonComponent; link: ReturnType<typeof useLinkHandlers>; consented: boolean; onConsent: (v: boolean) => void;
}) {
  const none = state.banks.length === 0;
  // Asked once per visit: the box stays (ticked) after the owner agrees, so it doesn't vanish under them.
  const [ask] = useState(() => !consented);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Plaid opens a secure window where you log in to your bank. Tick every business account at that bank in one go.
        If your card is at a different bank, link that bank too.
      </p>
      {link.linkMessage && (
        <Alert variant="destructive" className="bg-background">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{link.linkMessage}</AlertDescription>
        </Alert>
      )}
      {!none && (
        <div className="divide-y divide-border rounded-lg border border-border">
          {state.banks.map((b) => <BankRow key={b.id} bank={b} LinkButton={LinkButton} onLinked={link.onLinked} onFailure={link.onFailure} />)}
        </div>
      )}
      {/* The permission again for an owner who came back to this step in a new visit. */}
      {ask && <ConsentBox id="pulse-consent-bank" checked={consented} onChange={onConsent} />}
      <LinkButton
        mode="new"
        label={none ? "Link your bank" : "Link another bank"}
        icon={<Plus className="w-4 h-4 mr-2" />}
        variant={none ? "default" : "outline"}
        disabled={!consented}
        onLinked={link.onLinked}
        onFailure={link.onFailure}
        className="w-full sm:w-auto"
      />
      <p className="text-xs text-muted-foreground">
        To add more accounts at a bank you already linked, press Add accounts on that bank. Linking the same bank twice isn't allowed.
      </p>
    </div>
  );
}

/** Accounts grouped by their bank, as the owner saw them in Plaid's window. */
function AccountsByBank({
  state, drafts, disabled,
}: {
  state: SetupState; drafts: ReturnType<typeof useAccountDrafts>; disabled: boolean;
}) {
  const done = state.settings.setup_completed_at;
  return (
    <>
      {state.banks.filter((b) => state.accounts.some((a) => a.item_row_id === b.id)).map((b) => (
        <div key={b.id} className="space-y-2">
          <div className="text-sm font-bold">{b.institution_name || "Your bank"}</div>
          <div className="divide-y divide-border rounded-lg border border-border">
            {state.accounts.filter((a) => a.item_row_id === b.id).map((a) => (
              <AccountRowEditor
                key={a.id}
                account={a}
                draft={drafts.draftFor(a)}
                onChange={(p) => drafts.update(a, p)}
                disabled={disabled}
                isNew={isNewAccount(a, done)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Accounts not in yet although a bank is linked: read them again every 3 s, for about a minute. */
const ACCOUNTS_POLL_MS = 3000;
const ACCOUNTS_POLL_TRIES = 20;

function AccountsStep({
  state, drafts, disabled, onRefresh,
}: {
  state: SetupState; drafts: ReturnType<typeof useAccountDrafts>; disabled: boolean; onRefresh: () => Promise<unknown>;
}) {
  const waiting = state.accounts.length === 0 && state.banks.length > 0;
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The next read starts 3 s after the last one finished, so a slow read is never cut short.
    const tick = async () => {
      if (!live) return;
      tries++;
      if (tries > ACCOUNTS_POLL_TRIES) {
        setGaveUp(true);
        return;
      }
      await onRefresh().catch(() => { /* the next try reads again */ });
      if (live) timer = setTimeout(() => void tick(), ACCOUNTS_POLL_MS);
    };
    timer = setTimeout(() => void tick(), ACCOUNTS_POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Turn on the accounts the business uses. Personal accounts stay off. They are never counted, and TreeCheck deletes
        their transactions when you finish.
      </p>
      {state.accounts.length === 0
        ? (
          <p className="text-sm text-muted-foreground" role="status" data-pulse-accounts-waiting>
            {!waiting
              ? "Your accounts show up here after you link a bank."
              : gaveUp
                ? "Still nothing? Reload this page. If your accounts still don't show up, contact TreeCheck."
                : <><Loader2 className="inline w-3.5 h-3.5 mr-1.5 animate-spin align-[-2px]" />Your accounts are still coming in from the bank. This takes a moment.</>}
          </p>
        )
        : <AccountsByBank state={state} drafts={drafts} disabled={disabled} />}
    </div>
  );
}

function FinishStep({ state, jobberImport, onEdit }: { state: SetupState; jobberImport?: JobberImport; onEdit: (s: StepKey) => void }) {
  const s = state.settings;
  const business = state.accounts.filter((a) => a.is_business);
  const cards = business.filter(isCreditCard);
  const payrollAccounts = payrollBanks(state).filter((a) => a.use_for_payroll);
  const paydays = upcomingPaydays(todayLocal(), s.pay_frequency, s.pay_anchor_date, 1);
  const progress = importText(jobberImport);
  // 44 px tall to tap, without making the line taller. The focus ring is drawn around the word, not the 44 px box,
  // so it doesn't cover the lines above and below.
  const edit = (to: StepKey) => (
    <Button variant="link" className="group h-11 min-w-[44px] px-2 -my-3 ml-0.5 text-xs align-middle focus-visible:ring-0 focus-visible:ring-offset-0" onClick={() => onEdit(to)}>
      <span className="rounded-sm px-0.5 group-focus-visible:ring-2 group-focus-visible:ring-ring">Change</span>
    </Button>
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Here's what you set up. When you finish, TreeCheck sorts your transactions and works out your numbers.</p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        <DoneLine ok={state.jobberConnected && !jobberImport?.reconnect}>
          {state.jobberAccountName ? `Jobber connected (${state.jobberAccountName})` : "Jobber connected"}{edit("jobber")}
          {progress && <span className="block text-xs text-muted-foreground">{progress}</span>}
        </DoneLine>
        <DoneLine ok={state.banks.length > 0}>
          {state.banks.map((b) => b.institution_name || "Your bank").join(", ")} linked{edit("banks")}
        </DoneLine>
        <DoneLine ok={business.length > 0}>
          Business accounts: {business.map(accountName).join(", ")}{edit("accounts")}
          {cards.map((c) => (
            <span key={c.id} className="block text-xs text-muted-foreground">
              {accountName(c)} counts {c.include_from ? `from ${formatDay(c.include_from)}` : "everything"}
            </span>
          ))}
        </DoneLine>
        <DoneLine ok={!!s.pay_frequency && payrollAccounts.length > 0}>
          {s.pay_frequency
            ? payrollAccounts.length > 0
              ? <>Payroll {scheduleText(s.pay_frequency, s.pay_anchor_date)} from {payrollAccounts.map(accountName).join(", ")}{paydays[0] ? `, next on ${formatWeekday(paydays[0])}` : ""}</>
              : "Payroll: choose the account it comes out of"
            : "Payroll not tracked"}
          {edit("payroll")}
        </DoneLine>
        <DoneLine ok={s.profit_target_monthly !== null}>
          {s.profit_target_monthly !== null ? `Goal: $${moneyText(s.profit_target_monthly)} profit a month` : "No monthly goal"}
          {edit("payroll")}
        </DoneLine>
      </ul>
      <p className="text-xs text-muted-foreground">
        Your first numbers can take a few minutes while TreeCheck brings in your past months from the bank and Jobber.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// After setup: the same pieces as a settings page

function SettingsPage({ state, actions, LinkButton, jobberNotice, focusSection, jobberImport, onOpenPulse, onLinkFailure }: PulseSetupWizardProps) {
  const accounts = useAccountDrafts(state.accounts);
  const refs = {
    jobber: useRef<HTMLDivElement>(null),
    banks: useRef<HTMLDivElement>(null),
    accounts: useRef<HTMLDivElement>(null),
    payroll: useRef<HTMLDivElement>(null),
  };
  // After a new bank or "Add accounts": the accounts as just read say whether any are waiting to be
  // turned on; once the page shows them, scroll there and say so.
  const [pointAt, setPointAt] = useState<string[] | null>(null);
  const link = useLinkHandlers(actions, {
    onLinkFailure,
    knownAccountIds: () => state.accounts.map((a) => a.id),
    onAccountsArrived: (fresh) => {
      const waiting = (fresh?.accounts ?? []).filter((a) => isNewAccount(a, fresh?.settings.setup_completed_at ?? null)).map((a) => a.id);
      if (waiting.length > 0) setPointAt(waiting);
    },
  });
  const [moreConsent, setMoreConsent] = useState(false);
  const [payroll, setPayroll] = useState<PayrollGoalValue>(() => payrollFromState(state, false));
  const [payrollDirty, setPayrollDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState<null | "accounts" | "payroll" | "jobber">(null);

  const banks = useMemo(() => payrollBanks(state), [state]);
  const pErrors = payrollErrors(payroll, banks.map((a) => a.id));
  const newAccounts = state.accounts.filter((a) => isNewAccount(a, state.settings.setup_completed_at));
  const progress = importText(jobberImport);

  useEffect(() => {
    if (focusSection) refs[focusSection].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSection]);
  useEffect(() => {
    if (!pointAt || !pointAt.every((id) => state.accounts.some((a) => a.id === id))) return;
    setPointAt(null);
    refs.accounts.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Turn on the new accounts the business uses, then press Save changes.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointAt, state.accounts]);

  const run = async (which: "accounts" | "payroll" | "jobber", work: () => Promise<void>) => {
    if (busy) return;
    setBusy(which);
    try {
      await work();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const accountsBlocked = !accounts.anyBusiness
    ? "Keep at least one business account."
    : accounts.missingChoice ? "Answer the question under each business card." : null;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LineChart className="w-6 h-6 text-primary shrink-0" /> Financial Pulse setup
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Change your Jobber connection, banks, accounts, payroll and goal.</p>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenPulse} className="shrink-0">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Pulse
        </Button>
      </div>

      <Section sectionRef={refs.jobber} icon={<Users className="w-5 h-5 text-primary" />} title="Jobber">
        <JobberNoticeAlert notice={jobberNotice} connected={state.jobberConnected} />
        {state.jobberConnected ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-primary" /> {connectedTo(state.jobberAccountName)}
            </p>
            {progress && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5" data-pulse-jobber-import>
                {jobberImport?.state === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
                {jobberImport?.state === "failed" && <AlertTriangle className={cn("w-3 h-3", WARN_ICON)} />}
                {progress}
              </p>
            )}
            <Button variant="outline" size="sm" onClick={() => void run("jobber", () => actions.connectJobber())} disabled={busy !== null}>
              {busy === "jobber" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Reconnect Jobber
            </Button>
            <p className="text-xs text-muted-foreground">Use this if your jobs or payments stop showing up, or Jobber asks you to sign in again.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Connect Jobber so your sales count.</p>
            <Button onClick={() => void run("jobber", () => actions.connectJobber())} disabled={busy !== null} className="w-full sm:w-auto">
              {busy === "jobber" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Connect Jobber
            </Button>
            <JobberTips />
          </div>
        )}
      </Section>

      <Section sectionRef={refs.banks} icon={<Landmark className="w-5 h-5 text-primary" />} title="Banks and cards">
        {link.linkMessage && (
          <Alert variant="destructive" className="bg-background">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{link.linkMessage}</AlertDescription>
          </Alert>
        )}
        {state.banks.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {state.banks.map((b) => <BankRow key={b.id} bank={b} LinkButton={LinkButton} onLinked={link.onLinked} onFailure={link.onFailure} />)}
          </div>
        )}
        <div className="space-y-3 pt-1">
          <p className="text-sm font-bold">Link another bank</p>
          <ConsentBox id="pulse-consent-more" checked={moreConsent} onChange={setMoreConsent} />
          <LinkButton
            mode="new"
            label="Link another bank"
            icon={<Plus className="w-4 h-4 mr-2" />}
            variant="outline"
            disabled={!moreConsent}
            onLinked={link.onLinked}
            onFailure={link.onFailure}
            className="w-full sm:w-auto"
          />
          <p className="text-xs text-muted-foreground">To add more accounts at a bank above, press Add accounts on it instead.</p>
        </div>
      </Section>

      <Section sectionRef={refs.accounts} icon={<Building2 className="w-5 h-5 text-primary" />} title="Business accounts">
        {newAccounts.length > 0 ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription data-pulse-new-accounts-note>
              Accounts added after setup start off. Turn on any the business uses so their costs count, then press Save changes.
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">Personal accounts are never counted.</p>
        )}
        <AccountsByBank state={state} drafts={accounts} disabled={busy !== null} />
        <SaveRow
          dirty={accounts.dirty}
          busy={busy === "accounts"}
          disabled={!!accountsBlocked}
          message={accounts.dirty ? accountsBlocked : null}
          onSave={() => run("accounts", async () => {
            const r = await actions.saveAccounts(accountPayload(state.accounts, accounts.draftFor));
            accounts.reset();
            await actions.refresh();
            toast.success(r.historyRepull ? "Saved. Bringing in that account's past transactions. Your numbers update in a few minutes." : "Saved.");
          })}
        />
      </Section>

      <Section sectionRef={refs.payroll} icon={<Wallet className="w-5 h-5 text-primary" />} title="Payroll and goal">
        <PayrollGoalForm
          value={payroll}
          onChange={(patch) => { setPayroll((p) => ({ ...p, ...patch })); setPayrollDirty(true); }}
          bankAccounts={banks}
          showErrors={showErrors}
          errors={pErrors}
          disabled={busy !== null}
        />
        <SaveRow
          dirty={payrollDirty}
          busy={busy === "payroll"}
          disabled={false}
          message={showErrors && Object.keys(pErrors).length > 0 ? "Fix the items marked in red." : null}
          onSave={() => {
            if (Object.keys(pErrors).length > 0) { setShowErrors(true); return; }
            void run("payroll", async () => {
              await savePayroll(state, actions, payroll);
              await actions.refresh();
              setPayrollDirty(false);
              setShowErrors(false);
              toast.success("Saved.");
            });
          }}
        />
      </Section>
    </div>
  );
}

function Section({
  sectionRef, icon, title, children,
}: {
  sectionRef: RefObject<HTMLDivElement>; icon: ReactNode; title: string; children: ReactNode;
}) {
  return (
    <div ref={sectionRef} className={SCROLL_MARGIN}>
      <Card className="p-5 sm:p-6 space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-bold">{icon}{title}</h2>
        {children}
      </Card>
    </div>
  );
}

function SaveRow({
  dirty, busy, disabled, message, onSave,
}: {
  dirty: boolean; busy: boolean; disabled: boolean; message: string | null; onSave: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
      <Button onClick={onSave} disabled={!dirty || busy || disabled} className="w-full sm:w-auto">
        {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save changes"}
      </Button>
      {message
        ? <span className="text-xs text-muted-foreground">{message}</span>
        : dirty && !busy && <span className="text-xs text-muted-foreground">You have unsaved changes.</span>}
    </div>
  );
}
