// Financial Pulse admin page for Mark (A5, W2-05).
// Who can use Financial Pulse while TreeCheck is on Plaid's free Trial. Never shows money amounts.
import { useState, type FormEvent } from "react";
import { AlertTriangle, Building2, CheckCircle2, ChevronDown, Landmark, Loader2, Minus, Plus, Search, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BAD_TEXT, GOOD_ICON, WARN_BORDER, WARN_ICON, WARN_PANEL, WARN_TEXT } from "../tone";
import { companyName, type AdminCompany, type AdminHealth, type FoundCompany, type PlaidEnv } from "@/lib/pulse/adminApi";

export interface PulseAdminScreenProps {
  companies: AdminCompany[] | null;
  health: AdminHealth | null;
  loadError: string | null;
  /** Owner ids with a change in flight. */
  busy: ReadonlySet<string>;
  /** A message to show under a company row (for example why a change was refused). */
  rowMessage: Record<string, string>;
  onToggle: (c: AdminCompany, enabled: boolean) => void;
  onMode: (c: AdminCompany, env: PlaidEnv) => void;
  onLimit: (c: AdminCompany, max: number) => void;
  onFind: (email: string) => Promise<{ company: FoundCompany } | { error: string }>;
  onEnable: (found: FoundCompany) => Promise<boolean>;
  onRetry: () => void;
}

// The most banks a company can be given here: pulse-admin and pulse_access.max_items both allow 10.
const MAX_LIMIT = 10;

function bankLine(b: AdminCompany["banks"][number]): { text: string; bad: boolean } {
  const name = b.institution_name?.trim() || "A bank";
  if (b.status === "removed") return { text: `${name}: removed`, bad: false };
  if (b.status === "login_required") return { text: `${name}: needs the owner to log in`, bad: true };
  if (b.status === "revoked") return { text: `${name}: connection turned off`, bad: true };
  if (b.status === "error") return { text: `${name}: not updating`, bad: true };
  if (b.status === "pending_expiration" || b.status === "pending_disconnect") return { text: `${name}: login expires soon`, bad: true };
  return { text: `${name}: connected`, bad: false };
}

export function PulseAdminScreen(props: PulseAdminScreenProps) {
  const h = props.health;
  const used = h?.production_connections.used ?? null;
  // null: no limit (Plaid's paid plan). Older servers send the Trial's 9 and 10.
  const cap = h ? h.production_connections.cap ?? null : 9;
  const limit = h ? h.production_connections.trial_limit ?? null : 10;
  const problems: string[] = [];
  if (h) {
    if (!h.secrets.PLAID_SECRET_PRODUCTION || !h.secrets.PLAID_TOKEN_KEY_PRODUCTION) problems.push("Real-bank keys aren't set up yet, so companies on real banks can't link a bank. Haris sets these up.");
    if (h.token_keys.production.configured && !h.token_keys.production.works) problems.push("The real-bank key isn't working. Ask Haris to check it before anyone links a bank.");
    if (h.token_keys.sandbox.configured && !h.token_keys.sandbox.works) problems.push("The test-bank key isn't working. Ask Haris to check it.");
    if (h.connections_needing_support > 0) problems.push(`${h.connections_needing_support} bank connection${h.connections_needing_support === 1 ? " needs" : "s need"} Haris to look at it.`);
  }
  const companies = (props.companies ?? []).slice().sort((a, b) => Number(b.enabled) - Number(a.enabled) || companyName(a.company).localeCompare(companyName(b.company)));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-primary" /> Financial Pulse access</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which companies can use Financial Pulse. Only TreeCheck admins see this page, and it never shows money amounts.
        </p>
      </header>

      {problems.length > 0 && (
        <section className={cn("rounded-lg border p-4 space-y-1.5", WARN_BORDER, WARN_PANEL)} aria-live="polite">
          <p className="font-bold flex items-center gap-2"><AlertTriangle className={cn("w-5 h-5", WARN_ICON)} /> Needs attention</p>
          {problems.map((x, i) => <p key={i} className="text-sm">{x}</p>)}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 items-start">
        <Card className="p-5 space-y-3">
          <p className="text-sm font-bold flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" /> {cap === null ? "Bank connections" : "Free bank connections"}</p>
          {used === null ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : cap === null || limit === null ? (
            <>
              <p className="text-3xl font-bold tabular-nums">{used} made</p>
              <p className="text-sm text-muted-foreground">Plaid's paid plan has no limit, so companies can keep linking banks.</p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums">{used} of {limit} used</p>
              <Progress value={(used / limit) * 100} className={cn("h-2.5 bg-foreground/10", used >= cap - 1 && "[&>div]:bg-warning")} aria-label="Free bank connections used" />
              <p className="text-sm text-muted-foreground">
                {used >= cap
                  ? `New bank links are stopped at ${cap}, so one stays spare. Talk to Haris before turning on more companies.`
                  : used >= cap - 1
                    ? `Only ${cap - used} left before new links stop. Talk to Haris before turning on more companies.`
                    : `Plaid's free plan allows ${limit}. Pulse stops new links at ${cap} so one stays spare. A removed bank still counts.`}
              </p>
            </>
          )}
        </Card>

        <FindCompanyCard onFind={props.onFind} onEnable={props.onEnable} />
      </div>

      <section className="space-y-2" aria-labelledby="pulse-admin-companies">
        <h2 id="pulse-admin-companies" className="text-lg font-bold">Companies</h2>
        {props.loadError ? (
          <Card className="p-5 text-sm">
            {props.loadError} <Button variant="link" className="p-0 h-auto" onClick={props.onRetry}>Try again</Button>
          </Card>
        ) : props.companies === null ? (
          <Card className="p-5 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</Card>
        ) : companies.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">No company has Financial Pulse yet. Find one above to turn it on.</Card>
        ) : (
          <Card className="p-0 divide-y divide-border">
            {companies.map((c) => (
              <CompanyRow
                key={c.owner_id}
                c={c}
                busy={props.busy.has(c.owner_id)}
                message={props.rowMessage[c.owner_id]}
                onToggle={props.onToggle}
                onMode={props.onMode}
                onLimit={props.onLimit}
              />
            ))}
          </Card>
        )}
      </section>

      {h && <SystemCheck h={h} />}
    </div>
  );
}

function CompanyRow({
  c,
  busy,
  message,
  onToggle,
  onMode,
  onLimit,
}: {
  c: AdminCompany;
  busy: boolean;
  message: string | undefined;
  onToggle: PulseAdminScreenProps["onToggle"];
  onMode: PulseAdminScreenProps["onMode"];
  onLimit: PulseAdminScreenProps["onLimit"];
}) {
  const banks = c.banks.filter((b) => b.status !== "removed");
  const id = `pulse-on-${c.owner_id}`;
  return (
    <div data-pulse-company={c.owner_id} className="p-4 sm:px-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold truncate">{companyName(c.company)}</p>
          <p className="text-xs text-muted-foreground truncate">{c.company?.email ?? ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {busy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Label htmlFor={id} className={cn("text-sm", c.enabled ? "text-primary font-bold" : "text-muted-foreground")}>{c.enabled ? "On" : "Off"}</Label>
          <Switch id={id} checked={c.enabled} disabled={busy} onCheckedChange={(v) => onToggle(c, v)} aria-label={`Financial Pulse for ${companyName(c.company)}`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Banks</span>
          <Select value={c.plaid_env} onValueChange={(v) => onMode(c, v as PlaidEnv)} disabled={busy}>
            <SelectTrigger className="h-8 w-[130px]" aria-label="Real or test banks"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="production">Real banks</SelectItem>
              <SelectItem value="sandbox">Test banks</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Bank limit</span>
          <div className="inline-flex items-center rounded-md border border-border">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy || c.max_items <= 1} onClick={() => onLimit(c, c.max_items - 1)} aria-label="One bank fewer"><Minus className="w-3.5 h-3.5" /></Button>
            <span className="w-7 text-center tabular-nums font-bold">{c.max_items}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={busy || c.max_items >= MAX_LIMIT} onClick={() => onLimit(c, c.max_items + 1)} aria-label="One bank more"><Plus className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      </div>
      <div className="text-sm space-y-0.5">
        {banks.length === 0 ? (
          <p className="text-muted-foreground">No bank linked yet.</p>
        ) : banks.map((b, i) => {
          const l = bankLine(b);
          return <p key={i} className={l.bad ? WARN_TEXT : "text-muted-foreground"}>{l.text}{b.plaid_env === "sandbox" ? " (test)" : ""}</p>;
        })}
      </div>
      {message && <p className={cn("text-sm", BAD_TEXT)}>{message}</p>}
    </div>
  );
}

function FindCompanyCard({ onFind, onEnable }: { onFind: PulseAdminScreenProps["onFind"]; onEnable: PulseAdminScreenProps["onEnable"] }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "found"; c: FoundCompany } | { kind: "error"; text: string } | { kind: "done"; name: string }>({ kind: "idle" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setState({ kind: "busy" });
    const r = await onFind(email.trim());
    setState("company" in r ? { kind: "found", c: r.company } : { kind: "error", text: r.error });
  };
  return (
    <Card className="p-5 space-y-3">
      <p className="text-sm font-bold flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Turn on for a company</p>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          id="pulse-admin-find"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (state.kind !== "busy") setState({ kind: "idle" }); }}
          placeholder="Owner's login email"
          aria-label="Owner's login email"
        />
        <Button type="submit" variant="outline" disabled={state.kind === "busy" || !email.trim()}>
          {state.kind === "busy" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          <span className="ml-1.5">Find</span>
        </Button>
      </form>
      {state.kind === "error" && <p className={cn("text-sm", BAD_TEXT)}>{state.text}</p>}
      {state.kind === "done" && <p className="text-sm text-primary flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {state.name} can now open Financial Pulse and set it up.</p>}
      {state.kind === "found" && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <p className="font-bold">{companyName(state.c)}</p>
          <p className="text-xs text-muted-foreground">{state.c.email} · company owner</p>
          {state.c.access?.enabled ? (
            <p className="text-sm text-muted-foreground">Financial Pulse is already on for this company.</p>
          ) : (
            <Button
              size="sm"
              onClick={async () => {
                const c = state.c;
                setState({ kind: "busy" });
                const ok = await onEnable(c);
                if (ok) { setEmail(""); setState({ kind: "done", name: companyName(c) }); } else setState({ kind: "found", c });
              }}
            >
              Turn on with real banks, up to 2
            </Button>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">While TreeCheck is on Plaid's free plan, only turn this on for people you know.</p>
    </Card>
  );
}

function SystemCheck({ h }: { h: AdminHealth }) {
  const [open, setOpen] = useState(false);
  const line = (ok: boolean, text: string) => (
    <p className="flex items-center gap-2">
      {ok ? <CheckCircle2 className={cn("w-4 h-4", GOOD_ICON)} /> : <AlertTriangle className={cn("w-4 h-4", WARN_ICON)} />} {text}
    </p>
  );
  return (
    <Card className="p-0 overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-accent transition-colors min-h-[48px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="font-bold">System check</span>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-1.5 text-sm">
          {line(!!h.secrets.PLAID_CLIENT_ID && !!h.secrets.PLAID_SECRET_SANDBOX, "Test-bank keys")}
          {line(!!h.secrets.PLAID_SECRET_PRODUCTION, "Real-bank keys")}
          {line(h.token_keys.sandbox.works, "Test-bank token key works")}
          {line(h.token_keys.production.works, "Real-bank token key works")}
          {line(h.connections_needing_support === 0, h.connections_needing_support === 0 ? "No bank connection needs support" : `${h.connections_needing_support} bank connection(s) need support`)}
          {line(h.redirect_uri_set, h.redirect_uri_set ? "Phone bank return address set" : "Phone bank return address not set (only some banks on phones need it)")}
        </div>
      )}
    </Card>
  );
}
