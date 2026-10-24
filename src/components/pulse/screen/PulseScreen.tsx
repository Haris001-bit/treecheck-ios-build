// Financial Pulse: the owner's screen (A11, A12).
// Four blocks: "<Month> so far" (status, profit, break-even, payroll, forecast), the period comparison
// with its Filters button, where the money goes, and "About these numbers". Every number can be tapped
// down to the payments or jobs behind it.
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Info,
  LineChart,
  ListChecks,
  Loader2,
  Settings2,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { JobberImportInfo } from "@/lib/pulse/api";
import type { Change, PeriodView, Snapshot, StatusReason } from "../../../../supabase/functions/_shared/pulse/engine";
import { PulseDrillDown, type DrillDown } from "./PulseDrillDown";
import { PulseCashflowChart } from "./PulseCashflowChart";
import {
  amountTone,
  BAD_BORDER,
  BAD_PANEL,
  BAD_TEXT,
  GOOD_BORDER,
  GOOD_ICON,
  GOOD_PANEL,
  GOOD_TEXT,
  WARN_BORDER,
  WARN_ICON,
  WARN_PANEL,
  WARN_TEXT,
} from "../tone";
import {
  agoText,
  allArrived,
  BROKEN_BANK,
  day,
  dayOfInstant,
  DEFAULT_CATEGORY_LABELS,
  jobberNeverRead,
  monthName,
  NOT_COUNTED_TEXT,
  revenueWords,
  PAYROLL_UNKNOWN_SENTENCE,
  payrollNotTracked,
  PERIOD_LABEL,
  type PeriodDays,
  type PulseDataSource,
  type SetupSection,
  timeOfInstant,
  upDownText,
  usd,
  weekday,
  keepTogether,
  weekdayDay,
} from "./pulseScreenTypes";

export interface PulseScreenProps {
  snapshot: Snapshot;
  companyName: string;
  /** The company's own category names (pulse_categories); the defaults fill gaps. */
  categoryLabels?: Record<string, string>;
  data: PulseDataSource;
  /** The current instant (ISO). */
  now?: string;
  /** A background refresh is running (pulse-get said refreshing). */
  refreshing?: boolean;
  /** The numbers are being read again (after the owner changed something); the old ones stay shown. */
  updating?: boolean;
  /** The last try to read the numbers again failed; the ones shown are from computed_at. */
  refreshFailed?: boolean;
  onRetry?: () => void;
  /** Jobber's first import as pulse-get reports it (a failing one is shown as a problem, not a wait). */
  jobberImport?: JobberImportInfo | null;
  initialPeriod?: PeriodDays;
  onReconnect: (bankItemId: string) => void;
  /** Opens setup, at one of its sections when given. */
  onOpenSetup: (section?: SetupSection) => void;
  onOpenTransactions: () => void;
  /** Called after the owner changed something (personal / business), so the numbers reload. */
  onChanged: () => void;
}

const STATUS_TITLE: Partial<Record<StatusReason["code"], string>> = {
  payroll_short: "Payroll is short",
  forecast_loss: "Losing money this month",
  mtd_loss: "Losing money this month",
  forecast_loss_early: "Heading for a loss",
  payroll_tight: "Payroll is tight",
  forecast_below_target: "Below your goal",
  profit_down: "Profit is down",
  bank_login_required: "A bank needs you to log in",
  bank_revoked: "A bank connection was turned off",
  bank_error: "A bank isn't updating",
  bank_stale: "Bank numbers are out of date",
  no_bank_linked: "Link your bank to see costs",
  jobber_disconnected: "Jobber isn't connected",
  jobber_not_connected: "Connect Jobber to see your jobs",
  numbers_missing: "Some numbers are missing",
  no_numbers_yet: "Getting your first numbers ready",
  payroll_history_building: "Still learning your payroll",
};

// Most important first: data problems, then money problems, then goals.
const PRIORITY: StatusReason["code"][] = [
  "no_numbers_yet", "no_bank_linked", "bank_login_required", "bank_revoked", "bank_error", "jobber_not_connected",
  "jobber_disconnected", "numbers_missing", "payroll_short", "mtd_loss", "forecast_loss", "forecast_loss_early",
  "payroll_tight", "bank_stale", "payroll_history_building", "forecast_below_target", "profit_down",
];
const rank = (code: StatusReason["code"]) => {
  const i = PRIORITY.indexOf(code);
  return i === -1 ? PRIORITY.length : i;
};

const BAD_BANK = new Set(["login_required", "revoked", "error"]);

export function PulseScreen(props: PulseScreenProps) {
  const { snapshot: s, data } = props;
  const [period, setPeriod] = useState<PeriodDays>(props.initialPeriod ?? "30");
  const [drill, setDrill] = useState<DrillDown | null>(null);
  const labels = useMemo(() => ({ ...DEFAULT_CATEGORY_LABELS, ...(props.categoryLabels ?? {}) }), [props.categoryLabels]);
  // While Jobber's past jobs are not in, sales would read as $0: no verdict yet.
  const firstDay = jobberNeverRead(s) || s.status.reasons.some((r) => r.code === "no_numbers_yet" || r.code === "no_bank_linked");
  const arrived = allArrived(s);
  const p = s.periods[period];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6 text-pretty">
      <Header s={s} props={props} />

      {firstDay ? (
        <FirstNumbersCard s={s} jobberImport={props.jobberImport} onOpenSetup={props.onOpenSetup} onReconnect={props.onReconnect} />
      ) : (
        <MonthCard s={s} onDrill={setDrill} onReconnect={props.onReconnect} onOpenSetup={props.onOpenSetup} />
      )}

      {firstDay ? (
        arrived ? null : (
          <p className="text-sm text-muted-foreground">
            {jobberNeverRead(s)
              ? "Your comparison and spending show up once your past jobs from Jobber are in."
              : "Your comparison and spending show up once your bank's past months arrive."}
          </p>
        )
      ) : (
        <>
          <PulseCashflowChart series={s.cashflow_30} basis={s.revenue_basis} />
          <CompareSection s={s} p={p} period={period} onPeriod={setPeriod} onDrill={setDrill} />
          <SpendingSection p={p} period={period} labels={labels} onDrill={setDrill} />
        </>
      )}

      <AboutSection s={s} />

      <PulseDrillDown
        drill={drill}
        data={data}
        basis={s.revenue_basis}
        withoutTax={s.revenue_without_tax}
        categoryLabels={labels}
        onOpen={setDrill}
        onClose={() => setDrill(null)}
        onChanged={props.onChanged}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header

function Header({ s, props }: { s: Snapshot; props: PulseScreenProps }) {
  const f = s.freshness;
  const badBank = f.banks.find((b) => BAD_BANK.has(b.status));
  const oldest = f.banks.reduce<number | null>((m, b) => (b.hours_since_update === null ? m : m === null ? b.hours_since_update : Math.max(m, b.hours_since_update)), null);
  const loading = f.banks.some((b) => !b.last_successful_update);
  let bankText: string;
  let warn = false;
  if (f.banks.length === 0) { bankText = "No bank linked yet"; warn = true; }
  else if (badBank) { bankText = `Bank numbers from ${badBank.last_successful_update ? dayOfInstant(badBank.last_successful_update) : "before linking"}`; warn = true; }
  else if (loading) bankText = "Bank still loading";
  else { bankText = `Bank updated ${agoText(oldest)}`; warn = (oldest ?? 0) > 72; }
  const imp = props.jobberImport;
  const jobberText = f.jobber.disconnected || imp?.reconnect
    ? "Jobber needs reconnecting"
    : !f.jobber.connected
      ? "Jobber not connected"
      : f.jobber.hours_since_sync === null
        ? imp?.failing ? "Jobber jobs not in yet" : "Jobber jobs coming in"
        : `Jobber ${agoText(f.jobber.hours_since_sync)}`;
  const jobberWarn = !(f.jobber.connected && !f.jobber.disconnected) || !!imp?.reconnect ||
    (f.jobber.hours_since_sync === null && !!imp?.failing);

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LineChart className="w-6 h-6 text-primary shrink-0" /> Financial Pulse
        </h1>
        <p className="text-sm text-muted-foreground mt-1 truncate">{props.companyName}</p>
        <p className="text-xs mt-0.5 flex flex-wrap gap-x-1.5">
          <span className={warn ? `${WARN_TEXT} font-bold` : "text-muted-foreground"}>{bankText}</span>
          <span className="text-muted-foreground">·</span>
          <span className={jobberWarn ? `${WARN_TEXT} font-bold` : "text-muted-foreground"}>{jobberText}</span>
          {props.updating ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground" role="status"><Loader2 className="w-3 h-3 animate-spin" /> updating your numbers</span>
          ) : props.refreshing && !props.refreshFailed && (
            <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> checking for new data</span>
          )}
        </p>
        {props.refreshFailed && !props.updating && (
          <p className="text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" role="status" data-pulse-refresh-failed>
            <span className={WARN_TEXT}>Couldn't update. These numbers are from {timeOfInstant(s.computed_at, props.now ? Date.parse(props.now) : undefined)}.</span>
            {props.onRetry && (
              <Button variant="outline" size="sm" className="h-7" onClick={props.onRetry}>Try again</Button>
            )}
          </p>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="outline" size="sm" className="h-11 min-w-11 sm:h-9 sm:min-w-0" onClick={props.onOpenTransactions} aria-label="All payments">
          <ListChecks className="w-4 h-4" /><span className="hidden sm:inline ml-1.5">All payments</span>
        </Button>
        <Button variant="outline" size="sm" className="h-11 min-w-11 sm:h-9 sm:min-w-0" onClick={() => props.onOpenSetup()} aria-label="Setup">
          <Settings2 className="w-4 h-4" /><span className="hidden sm:inline ml-1.5">Setup</span>
        </Button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// "<Month> so far"

function monthEndOf(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** One plain sentence per reason; numbers already shown on the card are not repeated. */
function reasonSentence(r: StatusReason, s: Snapshot): string {
  const month = monthName(s.today);
  const bank = r.ref ? s.freshness.banks.find((b) => b.id === r.ref) : null;
  const bankName = bank?.name ?? "Your bank";
  const since = bank?.last_successful_update ? dayOfInstant(bank.last_successful_update) : null;
  switch (r.code) {
    case "payroll_short": return `${weekday(s.payroll.next_payday)}'s payroll is more than the money in your payroll account.`;
    case "payroll_tight": return `${weekday(s.payroll.next_payday)}'s payroll leaves less than the ${usd(s.payroll.reserve)} you want to keep.`;
    case "mtd_loss": return `You've spent more than you've made so far this month.`;
    case "forecast_loss": return `${month} is heading for a loss.`;
    case "forecast_loss_early": return `${month} is heading for a loss if this pace keeps up.`;
    case "forecast_below_target": return s.break_even.target !== null ? `On pace to end ${month} below your ${usd(s.break_even.target)} goal.` : r.text;
    case "bank_login_required": return `${bankName} stopped updating${since ? ` on ${since}` : ""}, so costs since then are missing.`;
    case "bank_revoked": return `${bankName}'s connection was turned off. Contact TreeCheck to set it up again.`;
    case "bank_error": return `${bankName} isn't updating. Press Reconnect to sign in again. If that doesn't fix it, contact TreeCheck.`;
    case "bank_stale": return `${bankName} hasn't updated${since ? ` since ${since}` : " for a while"}.`;
    case "jobber_not_connected": return "Connect Jobber in Setup so your completed jobs count.";
    case "jobber_disconnected": return s.freshness.jobber.connected
      ? `Jobber stopped sending your ${revenueWords(s.revenue_basis).updates}. Press Reconnect Jobber in Setup.`
      : `Jobber was disconnected, so new ${revenueWords(s.revenue_basis).updates} don't count. Press Connect Jobber in Setup.`;
    case "payroll_history_building": return "Still learning your payroll. Type what one payday usually costs in Setup to see it now.";
    default: return r.text;
  }
}

function tone(level: "green" | "yellow" | "red") {
  return level === "green"
    ? { head: GOOD_PANEL, border: GOOD_BORDER, dot: "bg-success/20 text-success", Icon: CheckCircle2 }
    : level === "yellow"
      ? { head: WARN_PANEL, border: WARN_BORDER, dot: "bg-warning/20 text-warning", Icon: AlertTriangle }
      : { head: BAD_PANEL, border: BAD_BORDER, dot: "bg-destructive/20 text-destructive", Icon: XCircle };
}

function MonthCard({
  s,
  onDrill,
  onReconnect,
  onOpenSetup,
}: {
  s: Snapshot;
  onDrill: (d: DrillDown) => void;
  onReconnect: (id: string) => void;
  onOpenSetup: (section?: SetupSection) => void;
}) {
  const m = s.profit_mtd;
  const f = s.forecast;
  const pr = s.payroll;
  const month = monthName(s.today);
  const monthEnd = day(monthEndOf(s.today));
  const t = tone(s.status.level);
  const reasons = [...s.status.reasons].sort((x, y) => rank(x.code) - rank(y.code));
  const title = s.status.level === "green" ? "On track" : (reasons[0] && STATUS_TITLE[reasons[0].code]) ?? "Needs a look";
  const sentences = s.status.level === "green" ? [] : reasons.slice(0, 2).map((r) => reasonSentence(r, s));
  const loginRef = reasons.find((r) => (r.code === "bank_login_required" || r.code === "bank_error") && r.ref)?.ref ?? null;
  const loginBank = loginRef ? s.freshness.banks.find((x) => x.id === loginRef) : null;
  const jobberSetup = reasons.some((r) => r.code === "jobber_not_connected" || r.code === "jobber_disconnected");
  const setupNeeded = jobberSetup || reasons.some((r) => r.code === "payroll_history_building");
  // Bank notices that need the owner but don't change the status: new accounts, login ending soon.
  // Only for banks the owner can still act on (a disconnected bank has no button in setup).
  const bankNotices = s.warnings.filter((w) => (w.code === "bank_new_accounts" || w.code === "bank_expiring") && w.ref &&
    s.freshness.banks.some((b) => b.id === w.ref && b.status !== "revoked"));
  const review = s.warnings.find((w) => w.code === "transfers_review");
  const reviewCount = review?.count ?? 0;
  const staleBank = s.freshness.banks.find((x) => BAD_BANK.has(x.status) || (x.hours_since_update ?? 0) > 72);
  const loss = m.profit < 0;
  const payrollCause = reasons.some((r) => r.code === "payroll_short" || r.code === "payroll_tight");
  const forecastCause = reasons.some((r) => r.code === "forecast_loss" || r.code === "forecast_loss_early" || r.code === "forecast_below_target");

  return (
    <Card className={cn("p-0 overflow-hidden border-2", t.border)}>
      <section className={cn("px-5 pt-4 pb-4", t.head)} aria-live="polite">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-3">
          <div className="flex items-center gap-2.5">
            <span className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", t.dot)}>
              <t.Icon className="w-5 h-5" />
            </span>
            <h2 className="text-xl font-bold">{title}</h2>
          </div>
          <span className="text-xs text-muted-foreground sm:whitespace-nowrap sm:pt-1.5 pl-[42px] sm:pl-0">{month} so far · day {f.day_of_month} of {f.days_in_month}</span>
        </div>
        {sentences.map((x, i) => <p key={i} className="text-sm mt-2">{x}</p>)}
        {(loginRef || setupNeeded) && (
          <div className="flex flex-wrap gap-2 mt-3">
            {loginRef && <Button size="sm" onClick={() => onReconnect(loginRef)}>Reconnect {loginBank?.name ?? "bank"}</Button>}
            {setupNeeded && <Button size="sm" variant="outline" onClick={() => onOpenSetup(jobberSetup ? "jobber" : "payroll")}>Open setup</Button>}
          </div>
        )}
        {bankNotices.map((w) => {
          const name = s.freshness.banks.find((b) => b.id === w.ref)?.name ?? "Your bank";
          return (
            <div key={`${w.code}-${w.ref}`} className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 rounded-lg bg-background/70 border border-border px-3 py-2 text-sm" data-pulse-bank-notice={w.code}>
              <span>
                {w.code === "bank_new_accounts"
                  ? `${name} has new accounts. Add the ones the business uses, then turn them on under Business accounts.`
                  : `${name} will ask you to sign in again soon. Reconnect it now to keep your numbers updating.`}
              </span>
              <Button size="sm" variant="outline" className="shrink-0 self-start sm:self-auto" onClick={() => onReconnect(w.ref as string)}>
                {w.code === "bank_new_accounts" ? "Add accounts" : "Reconnect"}
              </Button>
            </div>
          );
        })}
        {reviewCount > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-background/70 border border-border px-3 py-2 text-sm">
            <span>{reviewCount === 1 ? "1 transfer went" : `${reviewCount} transfers went`} to an account TreeCheck can't see, so {reviewCount === 1 ? "it counts" : "they count"} as a cost.</span>
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => onDrill({ kind: "review", title: "Transfers to check", from: s.periods["30"].last.from, to: s.today })}>Check it</Button>
          </div>
        )}
      </section>

      <div className="px-5 pt-4 pb-5 space-y-3">
        <div>
          <p className="text-sm text-muted-foreground">{loss ? `Loss so far in ${month}` : `Profit so far in ${month}`}</p>
          <p className={cn("text-4xl font-bold tabular-nums", amountTone(m.profit))}>{usd(Math.abs(m.profit))}</p>
          {staleBank && (
            <p className={cn("text-xs mt-1", WARN_TEXT)}>
              Costs since {staleBank.last_successful_update ? dayOfInstant(staleBank.last_successful_update) : "linking"} are missing, so profit may look higher than it is.
            </p>
          )}
        </div>

        <BreakEvenLine s={s} />

        <div className="grid grid-cols-2 gap-2">
          <TapTile
            label={revenueWords(s.revenue_basis).title}
            sub="from Jobber"
            value={usd(m.revenue)}
            valueClass={amountTone(m.revenue)}
            onClick={() => onDrill({ kind: "revenue", title: `${revenueWords(s.revenue_basis).title}, ${month} so far`, from: m.from, to: m.to, basis: s.revenue_basis })}
          />
          <TapTile
            label="Costs"
            sub="bank and card"
            value={usd(m.cost)}
            valueClass={amountTone(m.cost, true)}
            onClick={() => onDrill({ kind: "costs", title: `Costs, ${month} so far`, categoryKey: null, from: m.from, to: m.to })}
          />
        </div>
      </div>

      <div className="border-t border-border divide-y divide-border">
        <ExpandRow
          label={pr.next_payday ? `Payroll ${keepTogether(weekdayDay(pr.next_payday))}` : "Next payroll"}
          hint={pr.days_to_payday !== null && pr.state !== "unknown" ? `in ${pr.days_to_payday} day${pr.days_to_payday === 1 ? "" : "s"}` : undefined}
          value={payrollValue(pr)}
          valueClass={pr.state === "covered" ? GOOD_TEXT : pr.state === "tight" ? WARN_TEXT : pr.state === "short" ? BAD_TEXT : "text-muted-foreground"}
          highlight={payrollCause ? (pr.state === "short" ? "red" : "amber") : null}
          defaultOpen={payrollCause}
        >
          <PayrollDetails s={s} onOpenSetup={onOpenSetup} />
        </ExpandRow>
        <ExpandRow
          label={`Expected profit ${keepTogether(`by ${monthEnd}`)}`}
          value={f.profit < 0 ? `a loss of about ${usd(-f.profit)}` : `about ${usd(f.profit)}`}
          valueClass={amountTone(f.profit)}
          highlight={forecastCause ? (s.status.level === "red" ? "red" : "amber") : null}
          defaultOpen={false}
        >
          <ForecastDetails s={s} />
        </ExpandRow>
      </div>
    </Card>
  );
}

function payrollValue(pr: Snapshot["payroll"]): string {
  if (payrollNotTracked(pr)) return "Not tracked";
  if (pr.state === "covered") return `Covered, ${usd(pr.margin)} to spare`;
  if (pr.state === "tight") return `Tight, ${usd(pr.margin)} left`;
  if (pr.state === "short") return `Short by ${usd(Math.abs(pr.margin ?? 0))}`;
  return "Not known yet";
}

function BreakEvenLine({ s }: { s: Snapshot }) {
  const b = s.break_even;
  const m = s.profit_mtd;
  const month = monthName(s.today);
  const words = revenueWords(s.revenue_basis);
  if (b.covered === null) return <p className="text-sm text-muted-foreground">{words.none} this month yet.</p>;
  if (!b.covered) {
    const pct = m.cost > 0 ? Math.min(100, Math.max(0, (m.revenue / m.cost) * 100)) : 0;
    return (
      <div className="space-y-1.5">
        <p className={cn("text-sm font-bold", BAD_TEXT)}>You need {usd(b.needed)} more in {words.lower} to cover {month}'s costs.</p>
        <Progress value={pct} className="h-2 bg-foreground/10 [&>div]:bg-destructive" aria-label={`${words.title} against costs this month`} />
      </div>
    );
  }
  if (b.target === null) return <p className="text-sm font-bold">Costs covered.</p>;
  const reached = (b.to_target ?? 0) <= 0;
  const pct = Math.min(100, Math.max(0, (m.profit / b.target) * 100));
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-bold">
        {reached ? `Costs covered, and your ${usd(b.target)} goal is reached.` : `Costs covered. ${usd(b.to_target)} more to reach your ${usd(b.target)} goal.`}
      </p>
      <Progress value={pct} className="h-2 bg-foreground/10" aria-label="Profit against your monthly goal" />
    </div>
  );
}

function TapTile({ label, sub, value, valueClass, onClick }: { label: string; sub: string; value: string; valueClass?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg border border-input holo-control px-3 py-2.5 hover:bg-accent transition-colors group min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="flex items-center justify-between gap-2 text-sm font-bold">
        {label} <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
      </span>
      <span className={cn("block text-lg font-bold tabular-nums", valueClass)}>{value}</span>
      <span className="block text-xs text-muted-foreground">{sub}</span>
    </button>
  );
}

function ExpandRow({
  label,
  hint,
  value,
  valueClass,
  highlight,
  defaultOpen,
  children,
}: {
  label: string;
  hint?: string;
  value: string;
  valueClass?: string;
  highlight: "amber" | "red" | null;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn(highlight === "amber" && WARN_PANEL, highlight === "red" && BAD_PANEL)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-accent transition-colors min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/* The label never gets narrower than its longest unbreakable piece (a date); the value gives way. */}
        <span className="min-w-min">
          <span className="font-bold">{label}</span>
          {hint && <span className="block sm:inline text-xs text-muted-foreground sm:ml-2">{hint}</span>}
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={cn("min-w-0 text-sm font-bold tabular-nums text-right break-words", valueClass)}>{value}</span>
          <ChevronDown className={cn("w-4 h-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="px-5 pb-4 -mt-1 text-sm space-y-1.5">{children}</div>}
    </div>
  );
}

function Line({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}{note && <span className="text-xs"> {note}</span>}</span>
      <span className="tabular-nums font-bold">{value}</span>
    </div>
  );
}

function PayrollDetails({ s, onOpenSetup }: { s: Snapshot; onOpenSetup: (section?: SetupSection) => void }) {
  const pr = s.payroll;
  if (payrollNotTracked(pr)) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">Payroll isn't tracked. If you pay a crew from your business bank, turn it on in Setup.</p>
        <Button size="sm" variant="outline" onClick={() => onOpenSetup("payroll")}>Open setup</Button>
      </div>
    );
  }
  if (pr.state === "unknown") {
    return (
      <div className="space-y-2">
        {pr.unknown_reasons.map((r) => <p key={r} className="text-muted-foreground">{PAYROLL_UNKNOWN_SENTENCE[r]}</p>)}
        <Button size="sm" variant="outline" onClick={() => onOpenSetup("payroll")}>Open setup</Button>
      </div>
    );
  }
  const asOfHours = pr.balance_as_of ? (Date.parse(s.computed_at) - Date.parse(pr.balance_as_of)) / 3_600_000 : null;
  const asOf = asOfHours !== null && asOfHours > 24 && pr.balance_as_of ? `(as of ${dayOfInstant(pr.balance_as_of)})` : undefined;
  const source = pr.estimate_source === "override"
    ? "your typical payroll from Setup"
    : pr.history_runs
      ? `average of your last ${pr.history_runs} payroll${pr.history_runs === 1 ? "" : "s"}, contractors included`
      : "";
  const need = pr.margin !== null ? pr.reserve - pr.margin : 0;
  return (
    <>
      <Line label={pr.payroll_accounts === 1 ? "In your payroll account" : `In your ${pr.payroll_accounts} payroll accounts`} note={asOf} value={usd(pr.cash)} />
      <Line label="Next payroll, about" value={usd(pr.estimated_payroll)} />
      {source && <p className="text-xs text-muted-foreground -mt-1">{source[0].toUpperCase() + source.slice(1)}.</p>}
      <Line label="You want to keep at least" value={usd(pr.reserve)} />
      {(pr.state === "tight" || pr.state === "short") && need > 0 && (
        <p className="font-bold pt-1">Put about {usd(need)} more in that account before {weekday(pr.next_payday)} to keep {usd(pr.reserve)}.</p>
      )}
    </>
  );
}

function ForecastDetails({ s }: { s: Snapshot }) {
  const f = s.forecast;
  const b = s.break_even;
  const monthEnd = day(monthEndOf(s.today));
  const words = revenueWords(s.revenue_basis);
  const driver = f.pace_only
    ? `Your Jobber schedule isn't loaded, so this uses only ${words.paceOnly} (${usd(f.pace_per_day)} a day).`
    : f.driver === "schedule"
      ? `Includes ${usd(f.scheduled_rest)} of work already scheduled in Jobber.`
      : s.revenue_basis === "payments"
        ? `Based on the ${usd(f.pace_per_day)} ${words.pace}. Jobber also has ${usd(f.scheduled_rest)} of work scheduled; payments for it can land next month.`
        : `Based on the ${usd(f.pace_per_day)} ${words.pace}. Jobber has ${usd(f.scheduled_rest)} more scheduled.`;
  return (
    <>
      <p className="text-muted-foreground">{driver}</p>
      <Line label={`${words.title} by ${monthEnd}`} value={usd(f.revenue)} />
      <Line label={`Costs by ${monthEnd}`} note="(at your last 30 days' rate)" value={usd(f.cost)} />
      {b.target !== null && b.forecast_vs_target !== null && f.profit >= 0 && (
        <p className="font-bold pt-1">
          {b.forecast_vs_target >= 0 ? `On pace to beat your ${usd(b.target)} goal by ${usd(b.forecast_vs_target)}.` : `On pace to miss your ${usd(b.target)} goal by ${usd(-b.forecast_vs_target)}.`}
        </p>
      )}
    </>
  );
}

function FirstNumbersCard({
  s,
  jobberImport,
  onOpenSetup,
  onReconnect,
}: {
  s: Snapshot;
  jobberImport?: JobberImportInfo | null;
  onOpenSetup: (section?: SetupSection) => void;
  onReconnect: (bankItemId: string) => void;
}) {
  const f = s.freshness;
  const pr = s.payroll;
  const neverRead = jobberNeverRead(s);
  // Jobber refused the stored sign-in, or the first import failed several tries in a row (pulse-get counts them).
  // The sign-in flag comes live with the import (the numbers may be from a few minutes earlier).
  const jobberSignIn = neverRead && (f.jobber.disconnected || !!jobberImport?.reconnect);
  const jobberStuck = neverRead && !jobberSignIn && !!jobberImport?.failing;
  const jobberProblem = jobberSignIn || jobberStuck || !f.jobber.connected;
  const notTracked = payrollNotTracked(pr);
  const payrollMissing = !notTracked && (pr.unknown_reasons.includes("no_schedule") || pr.unknown_reasons.includes("no_payroll_account"));
  const needsSetup = jobberProblem || f.banks.length === 0 || payrollMissing;
  const section: SetupSection = jobberProblem ? "jobber" : f.banks.length === 0 ? "banks" : "payroll";
  // Everything has arrived and still nothing counts yet (for example a card counted from today).
  const arrived = allArrived(s);
  return (
    <Card className={cn("p-5 space-y-4", (jobberSignIn || jobberStuck) && `border-2 ${WARN_BORDER}`)}>
      <div className="flex items-center gap-3">
        {jobberSignIn || jobberStuck
          ? <span className={cn("w-9 h-9 rounded-full bg-warning/15 flex items-center justify-center shrink-0", WARN_ICON)}><AlertTriangle className="w-5 h-5" /></span>
          : <span className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0"><Clock className="w-5 h-5" /></span>}
        <div>
          {jobberSignIn || jobberStuck ? (
            <>
              <h2 className="text-xl font-bold">{jobberSignIn ? "Reconnect Jobber to get your numbers" : "Your past jobs couldn't come in"}</h2>
              <p className="text-sm text-muted-foreground">
                {jobberSignIn
                  ? "Jobber asked you to sign in again. Your numbers start once your past jobs are in."
                  : "Jobber didn't send your past jobs after several tries. Your numbers start once they're in."}
              </p>
            </>
          ) : arrived ? (
            <>
              <h2 className="text-xl font-bold">{revenueWords(s.revenue_basis).none} yet</h2>
              <p className="text-sm text-muted-foreground">
                {revenueWords(s.revenue_basis).noneLong}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold">Getting your first numbers ready</h2>
              <p className="text-sm text-muted-foreground">Usually a few minutes. Some banks take up to a day for older months. This page updates by itself.</p>
            </>
          )}
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {f.banks.length === 0 && <li className="flex gap-2"><AlertTriangle className={cn("w-4 h-4 mt-0.5", WARN_ICON)} /> Link your bank in Setup.</li>}
        {f.banks.map((b) => {
          const broken = BROKEN_BANK.has(b.status);
          return (
            <li key={b.id} className="flex gap-2 items-start">
              {broken
                ? <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", WARN_ICON)} />
                : b.last_successful_update ? <CheckCircle2 className={cn("w-4 h-4 mt-0.5 shrink-0", GOOD_ICON)} /> : <Loader2 className="w-4 h-4 animate-spin text-primary mt-0.5 shrink-0" />}
              <span className="min-w-0">
                {b.name}: {broken
                  ? b.status === "revoked" ? "the connection was turned off. Contact TreeCheck." : b.status === "error" ? "isn't updating" : "needs you to log in again"
                  : b.last_successful_update ? "connected" : "bringing in your past months"}
                {broken && b.status !== "revoked" && (
                  <Button size="sm" variant="outline" className="ml-2 h-7" onClick={() => onReconnect(b.id)}>Reconnect</Button>
                )}
              </span>
            </li>
          );
        })}
        <li className="flex gap-2 items-start" data-pulse-jobber-line>
          {jobberProblem
            ? <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", WARN_ICON)} />
            : neverRead ? <Loader2 className="w-4 h-4 animate-spin text-primary mt-0.5 shrink-0" /> : <CheckCircle2 className={cn("w-4 h-4 mt-0.5 shrink-0", GOOD_ICON)} />}
          <span>
            {!f.jobber.connected
              ? "Jobber: connect it in Setup so your completed jobs count"
              : jobberSignIn
                ? "Jobber: needs you to sign in again before your past jobs can come in. Press Reconnect Jobber in Setup."
                : jobberStuck
                  ? "Jobber: your past jobs couldn't come in yet. Press Reconnect Jobber in Setup. If that doesn't fix it, contact TreeCheck."
                  : neverRead ? "Jobber: bringing in your completed jobs" : "Jobber: connected"}
          </span>
        </li>
        {notTracked
          ? <li className="flex gap-2 items-start text-muted-foreground"><Info className="w-4 h-4 mt-0.5" /> Payroll isn't tracked.</li>
          : pr.unknown_reasons.filter((r) => r === "no_schedule" || r === "no_payroll_account").map((r) => (
            <li key={r} className="flex gap-2 items-start"><AlertTriangle className={cn("w-4 h-4 mt-0.5", WARN_ICON)} /> {PAYROLL_UNKNOWN_SENTENCE[r]}</li>
          ))}
      </ul>
      {needsSetup && <Button size="sm" variant="outline" onClick={() => onOpenSetup(section)}>Open setup</Button>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Comparison

function PeriodFilter({ value, onChange }: { value: PeriodDays; onChange: (v: PeriodDays) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Filters: ${PERIOD_LABEL[value]}`}>
          <SlidersHorizontal className="w-4 h-4 mr-1.5" /> Filters
          <Badge variant="secondary" className="ml-2 font-normal">{PERIOD_LABEL[value]}</Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as PeriodDays)}>
          {(["7", "14", "30"] as PeriodDays[]).map((d) => (
            <DropdownMenuRadioItem key={d} value={d}>{PERIOD_LABEL[d]}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function profitWords(n: number): string {
  return n < 0 ? `a ${usd(-n)} loss` : usd(n);
}

function CompareSection({
  s,
  p,
  period,
  onPeriod,
  onDrill,
}: {
  s: Snapshot;
  p: PeriodView;
  period: PeriodDays;
  onPeriod: (v: PeriodDays) => void;
  onDrill: (d: DrillDown) => void;
}) {
  const label = PERIOD_LABEL[period];
  const partialFrom = !p.comparable ? (p.prev.partial_from ?? p.last.partial_from) : null;
  return (
    <section className="space-y-2" aria-labelledby="pulse-compare">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pulse-compare" className="text-lg font-bold">{label} vs the {p.days} days before</h2>
        <PeriodFilter value={period} onChange={onPeriod} />
      </div>
      <p className="text-xs text-muted-foreground">Rolling days ({day(p.last.from)} to {day(p.last.to)}), so these won't match {monthName(s.today)} above.</p>
      {!p.last.has_data ? (
        <Card className="p-5"><p className="text-sm text-muted-foreground">No numbers for this period yet.</p></Card>
      ) : (
        <Card className="p-0 overflow-hidden divide-y divide-border">
          <CompareRow label="Profit" value={profitWords(p.last.profit)} prev={p.prev.has_data ? profitWords(p.prev.profit) : null} change={p.profit} costRow={false} fair={p.comparable} days={p.days} strong />
          <CompareRow
            label={revenueWords(s.revenue_basis).title}
            value={usd(p.last.revenue)}
            prev={p.prev.has_data ? usd(p.prev.revenue) : null}
            change={p.revenue}
            costRow={false}
            fair={p.comparable}
            days={p.days}
            onClick={() => onDrill({ kind: "revenue", title: `${revenueWords(s.revenue_basis).title}, ${label.toLowerCase()}`, from: p.last.from, to: p.last.to, basis: s.revenue_basis })}
          />
          <CompareRow
            label="Costs"
            value={usd(p.last.cost)}
            prev={p.prev.has_data ? usd(p.prev.cost) : null}
            change={p.cost}
            costRow
            fair={p.comparable}
            days={p.days}
            onClick={() => onDrill({ kind: "costs", title: `Costs, ${label.toLowerCase()}`, categoryKey: null, from: p.last.from, to: p.last.to })}
          />
        </Card>
      )}
      {partialFrom && (
        <p className="text-xs text-muted-foreground flex gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {(s.coverage.label ?? "").replace(/ (not counted before|history starts) .*$/, "") || "One of your accounts"} only counts from {day(partialFrom)}, so the days before are missing its costs. Treat this comparison as rough.
        </p>
      )}
    </section>
  );
}

function CompareRow({
  label,
  value,
  prev,
  change,
  costRow,
  fair,
  days,
  strong,
  onClick,
}: {
  label: string;
  value: string;
  prev: string | null;
  change: Change;
  costRow: boolean;
  fair: boolean;
  days: number;
  strong?: boolean;
  onClick?: () => void;
}) {
  const good = costRow ? change.amount <= 0 : change.amount >= 0;
  const changeClass = !fair || prev === null || change.amount === 0 ? "text-muted-foreground" : good ? GOOD_TEXT : BAD_TEXT;
  const body = (
    <>
      <span className="min-w-0">
        <span className="block font-bold">{label}</span>
        <span className="block text-xs text-muted-foreground">{prev === null ? "Nothing to compare yet" : `vs ${prev} the ${days} days before`}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <span className="text-right">
          <span className={cn("block tabular-nums font-bold", strong && "text-lg")}>{value}</span>
          {prev !== null && <span className={cn("block text-xs tabular-nums", changeClass)}>{upDownText(change)}</span>}
        </span>
        {onClick && <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-accent transition-colors group min-h-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      {body}
    </button>
  ) : (
    <div className="flex items-center justify-between gap-3 px-5 py-3 min-h-[52px]">{body}</div>
  );
}

// ---------------------------------------------------------------------------
// Where the money goes

function SpendingSection({
  p,
  period,
  labels,
  onDrill,
}: {
  p: PeriodView;
  period: PeriodDays;
  labels: Record<string, string>;
  onDrill: (d: DrillDown) => void;
}) {
  const sp = p.spending;
  const periodText = PERIOD_LABEL[period].toLowerCase();
  const out = sp.not_counted.filter((l) => l.reason !== "inflow" && l.money_out > 0);
  const outTotal = out.reduce((a, l) => a + l.money_out, 0);
  const outNames = out.map((l) => (NOT_COUNTED_TEXT[l.reason]?.label ?? l.label).toLowerCase());
  return (
    <section className="space-y-2" aria-labelledby="pulse-spend">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pulse-spend" className="text-lg font-bold">Where the money goes</h2>
        <span className="text-sm text-muted-foreground">{PERIOD_LABEL[period]}</span>
      </div>
      <Card className="p-0 overflow-hidden">
        {sp.categories.length === 0 ? (
          <p className="text-sm text-muted-foreground p-5">No costs in this period.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sp.categories.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => onDrill({ kind: "costs", title: `${labels[c.key] ?? "Other"}, ${periodText}`, categoryKey: c.key, from: sp.from, to: sp.to })}
                  className="w-full text-left px-5 py-3 hover:bg-accent transition-colors group min-h-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold">{labels[c.key] ?? "Other"}</span>
                    <span className="flex items-center gap-1.5 font-bold tabular-nums">
                      {usd(c.amount)}
                      <span className="text-xs font-normal text-muted-foreground w-9 text-right">{c.share_pct === null ? "" : `${Math.round(c.share_pct)}%`}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                    </span>
                  </div>
                  <Progress value={Math.max(0, c.share_pct ?? 0)} className="h-1.5 mt-2 bg-foreground/10" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {(outTotal > 0 || sp.not_counted.some((l) => l.reason === "inflow" && l.money_in > 0)) && (
          <button
            type="button"
            onClick={() => onDrill({ kind: "notcounted", title: "Money that isn't a cost", from: sp.from, to: sp.to, lines: sp.not_counted })}
            className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left border-t border-dashed border-border hover:bg-accent transition-colors group min-h-[52px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="min-w-0">
              <span className="block text-sm font-bold">{usd(outTotal)} moved but isn't a cost</span>
              <span className="block text-xs text-muted-foreground">{outNames.length ? outNames.join(", ") : "Deposits only"}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
          </button>
        )}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// About these numbers

function AboutSection({ s }: { s: Snapshot }) {
  const [open, setOpen] = useState(false);
  const f = s.freshness;
  const info = s.warnings.filter((w) => w.code === "card_counted_from" || w.code === "account_counted_from" || w.code === "pending_not_counted" || w.code === "forecast_pace_only");
  return (
    <div className="space-y-2">
      <Card className="p-0 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-accent transition-colors min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="flex items-center gap-2 font-bold"><Info className="w-4 h-4 text-primary" /> About these numbers</span>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="px-5 pb-5 space-y-4 text-sm">
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Last updated</p>
              {f.banks.map((b) => (
                <p key={b.id}>
                  {b.name}: {BAD_BANK.has(b.status)
                    ? `stopped updating${b.last_successful_update ? ` on ${dayOfInstant(b.last_successful_update)}` : ""}`
                    : b.last_successful_update ? agoText(b.hours_since_update) : "still bringing in past months"}
                  {b.last_successful_update && !b.historical_update_complete ? " (older months still loading)" : ""}
                </p>
              ))}
              <p>Jobber: {f.jobber.connected && !f.jobber.disconnected ? agoText(f.jobber.hours_since_sync) : "not connected"}</p>
              {info.map((w, i) => (
                <p key={`${w.code}-${i}`} className="text-muted-foreground">{infoSentence(w)}</p>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Good to know</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>{revenueWords(s.revenue_basis).rule}</li>
                {s.revenue_without_tax && <li>Sales are counted without sales tax.</li>}
                <li>Costs count on the day they're paid, so a big yearly bill makes that month look weaker.</li>
                <li>Loan payments aren't counted as costs.</li>
                <li>Personal and business spending on the same account can't be told apart. Tap a payment and choose "Personal, not business".</li>
                <li>Money kept in Cash App, or in accounts you haven't linked, isn't seen.</li>
              </ul>
            </div>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground text-center">A quick estimate for running the business. Not for taxes. Your accountant's books are the official numbers.</p>
    </div>
  );
}

function infoSentence(w: Snapshot["warnings"][number]): string {
  switch (w.code) {
    case "card_counted_from":
    case "account_counted_from":
      return w.date ? w.text.replace(/ counted from .*$/, ` counts from ${day(w.date)}.`) : w.text;
    case "pending_not_counted":
      return w.amount !== null ? `${usd(w.amount)} hasn't cleared yet. It counts once the bank clears it.` : w.text;
    case "forecast_pace_only":
      return "The expected profit doesn't include your Jobber schedule yet.";
    default:
      return w.text;
  }
}
