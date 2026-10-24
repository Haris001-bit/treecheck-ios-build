// Financial Pulse setup: the pieces each step and settings section is built from.
import type { ComponentType, ReactNode } from "react";
import { CheckCircle2, CreditCard, Landmark, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { PlaidLinkButtonProps, PlaidLinkedResult } from "@/components/pulse/PlaidLinkButton";
import type { PulseFailure } from "@/lib/pulse/api";
import { BAD_CHIP, BAD_TEXT, CHOICE_OFF, CHOICE_ON, CHOICE_TILE, GOOD_CHIP } from "../tone";
import {
  accountKind,
  accountName,
  anchorFromSchedule,
  type Draft,
  FREQUENCY_LABEL,
  formatDay,
  formatWeekday,
  formatWhen,
  isCreditCard,
  NEEDS_RECONNECT,
  ordinal,
  PAY_FREQUENCIES,
  type PaySchedule,
  type SemiPair,
  type SetupAccount,
  type SetupBank,
  todayLocal,
  upcomingPaydays,
} from "./setupModel";

export type LinkButtonComponent = ComponentType<PlaidLinkButtonProps>;

const PLAID_PRIVACY_URL = "https://plaid.com/legal/#end-user-privacy-policy";
// TreeCheck's own policy, shown where Plaid Link is opened (Plaid security questionnaire, 2026-10-23).
const TREECHECK_PRIVACY_URL = "https://app.treecheck.ai/privacy";

// ---------------------------------------------------------------------------
// The permission an owner gives before linking a bank (consent version pulse-consent-2: keep the words;
// pulse-consent-1 was the same text without the TreeCheck Privacy Policy sentence)

export function ConsentBox({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="rounded-lg border border-border bg-background/70 p-4 space-y-3">
      <div className="flex items-center gap-2 font-bold text-sm">
        <ShieldCheck className="w-4 h-4 text-primary" /> Your permission
      </div>
      <div className="text-sm text-muted-foreground space-y-2">
        <p>
          TreeCheck uses Plaid to connect your business bank account and credit card. TreeCheck only reads your
          transactions and balances. It can't move money, and it never sees your bank username or password.
        </p>
        <p>
          Plaid handles the connection. You can read how Plaid treats your information in{" "}
          <a href={PLAID_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Plaid's End User Privacy Policy
          </a>
          . To disconnect a bank later, contact TreeCheck.
        </p>
        <p>
          How TreeCheck uses and protects your data, how long it is kept and how to delete it is in{" "}
          <a href={TREECHECK_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            TreeCheck's Privacy Policy
          </a>
          .
        </p>
      </div>
      <Label htmlFor={id} className="flex w-fit items-center gap-2 min-h-[44px] pr-2 cursor-pointer">
        <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
        I agree
      </Label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A linked bank

export function BankRow({
  bank,
  LinkButton,
  onLinked,
  onFailure,
}: {
  bank: SetupBank;
  LinkButton: LinkButtonComponent;
  onLinked: (result: PlaidLinkedResult) => void;
  onFailure: (failure: PulseFailure) => void;
}) {
  const needsReconnect = NEEDS_RECONNECT.has(bank.status);
  const active = bank.status === "active";
  // New accounts waiting: a Reconnect offers them too, so the prompt is never lost.
  const newAccounts = bank.new_accounts_available && (active || needsReconnect);

  let badge = <Badge variant="secondary">Connected</Badge>;
  const notes: string[] = [];
  if (bank.status === "error") {
    badge = <Badge variant="outline" className={BAD_CHIP}>Connection problem</Badge>;
    notes.push("We couldn't reach this bank. Press Reconnect to sign in again. If that doesn't fix it, contact TreeCheck.");
  } else if (needsReconnect) {
    badge = <Badge variant="outline" className={BAD_CHIP}>Needs login</Badge>;
    notes.push(bank.status === "login_required"
      ? "Your bank needs you to sign in again before we can see new transactions. Press Reconnect."
      : "Your bank will soon ask you to sign in again. Press Reconnect now to keep your numbers up to date.");
  } else if (bank.status === "revoked") {
    badge = <Badge variant="outline" className={BAD_CHIP}>Disconnected</Badge>;
    notes.push("This connection was turned off at your bank. Please contact TreeCheck to set it up again.");
  } else if (!active) {
    badge = <Badge variant="outline">Unavailable</Badge>;
    notes.push("This connection isn't available right now. Please contact TreeCheck.");
  } else if (newAccounts) {
    badge = <Badge variant="outline" className={GOOD_CHIP}>New accounts available</Badge>;
  }
  if (newAccounts) notes.push("Your bank has accounts that aren't linked yet. Add them, then turn on the ones the business uses under Business accounts.");

  return (
    <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" data-pulse-bank={bank.id}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="font-bold truncate">{bank.institution_name || "Your bank"}</span>
          {badge}
        </div>
        <div className="text-xs text-muted-foreground">{formatWhen(bank.last_successful_update)}</div>
        {notes.map((n) => <div key={n} className="text-xs text-muted-foreground">{n}</div>)}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        {needsReconnect && (
          <LinkButton
            mode="update"
            itemRowId={bank.id}
            accountSelection={newAccounts}
            label="Reconnect"
            icon={<RefreshCw className="w-4 h-4 mr-2" />}
            size="sm"
            onLinked={onLinked}
            onFailure={onFailure}
          />
        )}
        {active && (
          <LinkButton
            mode="update"
            itemRowId={bank.id}
            accountSelection
            label={newAccounts ? "Add new accounts" : "Add accounts"}
            icon={<Plus className="w-4 h-4 mr-2" />}
            size="sm"
            variant={newAccounts ? "default" : "outline"}
            onLinked={onLinked}
            onFailure={onFailure}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One account: business or not, and for a business card, where it starts counting

export function AccountRowEditor({
  account,
  draft,
  onChange,
  disabled,
  isNew = false,
}: {
  account: SetupAccount;
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  disabled: boolean;
  /** Came in after setup and not turned on yet. */
  isNew?: boolean;
}) {
  const isCard = isCreditCard(account);
  const today = todayLocal();
  // The date "it was personal before" would set: the card's own date when it already counts from one.
  const fromDate = draft.include_from ?? (account.is_business ? account.include_from : null) ?? today;
  const fromLabel = fromDate === today ? "Count from today" : `Count from ${formatDay(fromDate)}`;
  const notShared = account.status === "closed" || account.status === "revoked";
  const idBase = `pulse-acct-${account.id}`;
  // No default: until the owner picks one, neither option is selected.
  const countChoice = draft.count_from_chosen ? (draft.include_from ? "from" : "all") : "";

  return (
    <div className="p-4 space-y-3" data-pulse-account={account.id}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-bold">
            {isCard ? <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" /> : <Landmark className="w-4 h-4 text-muted-foreground shrink-0" />}
            <span className="break-words min-w-0">{account.name || "Account"}</span>
            {isNew && <Badge variant="outline" className={GOOD_CHIP}>New</Badge>}
            {notShared && <Badge variant="outline">No longer shared</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            {accountKind(account)}
            {account.mask ? ` ending in ${account.mask}` : ""}
          </div>
          {notShared && draft.is_business && (
            <div className="text-xs text-muted-foreground mt-1">
              Your bank stopped sharing this account. Its past payments still count. Switch it to Not business to delete them.
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Label htmlFor={`${idBase}-business`} className={cn("text-sm cursor-pointer", draft.is_business ? "text-primary font-bold" : "text-muted-foreground")}>
            {draft.is_business ? "Business" : "Not business"}
          </Label>
          <Switch
            id={`${idBase}-business`}
            aria-label={`${account.name || "Account"} is a business account`}
            checked={draft.is_business}
            disabled={disabled}
            onCheckedChange={(checked) => onChange({ is_business: checked })}
          />
        </div>
      </div>

      {draft.is_business && isCard && (
        <div className="ml-6 space-y-2">
          <div id={`${idBase}-choose`} className="text-sm font-bold">
            Was this card only for the business until now?
          </div>
          <RadioGroup
            value={countChoice}
            disabled={disabled}
            aria-labelledby={`${idBase}-choose`}
            onValueChange={(value) => onChange({
              count_from_chosen: true,
              // A business card keeps the date it already counts from; a card just turned on starts today.
              include_from: value === "from" ? fromDate : null,
            })}
          >
            <Label htmlFor={`${idBase}-all`} className={cn(CHOICE_TILE, "items-start leading-snug", countChoice === "all" ? CHOICE_ON : CHOICE_OFF)}>
              <RadioGroupItem value="all" id={`${idBase}-all`} className="mt-0.5" />
              <span>Yes, count everything on it</span>
            </Label>
            <Label htmlFor={`${idBase}-from`} className={cn(CHOICE_TILE, "items-start leading-snug", countChoice === "from" ? CHOICE_ON : CHOICE_OFF)}>
              <RadioGroupItem value="from" id={`${idBase}-from`} className="mt-0.5" />
              <span>No, it was personal before. {fromLabel}</span>
            </Label>
          </RadioGroup>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payroll and goal

export interface PayrollGoalValue extends PaySchedule {
  /** "yes": the business pays a crew from a linked account; "no": no payroll to track. */
  runsPayroll: "yes" | "no";
  payrollAccountIds: string[];
  typicalPayroll: string;
  profitGoal: string;
  cashReserve: string;
}

export type PayrollErrorKey = "accounts" | "frequency" | "schedule" | "typicalPayroll" | "profitGoal" | "cashReserve";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-background px-3 text-sm [color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function PayrollGoalForm({
  value,
  onChange,
  bankAccounts,
  showErrors,
  errors,
  disabled,
}: {
  value: PayrollGoalValue;
  onChange: (patch: Partial<PayrollGoalValue>) => void;
  /** Business bank accounts (cards can't pay payroll). */
  bankAccounts: SetupAccount[];
  showErrors: boolean;
  errors: Partial<Record<PayrollErrorKey, string>>;
  disabled: boolean;
}) {
  const today = todayLocal();
  const anchor = value.runsPayroll === "yes" ? anchorFromSchedule(value, today) : null;
  const paydays = upcomingPaydays(today, value.frequency, anchor);
  // An error is tied to its question, so a screen reader reads it with the field.
  const shown = (k: PayrollErrorKey) => showErrors && !!errors[k];
  const errId = (k: PayrollErrorKey) => `pulse-err-${k}`;
  const invalid = (k: PayrollErrorKey) => (shown(k) ? { "aria-invalid": true as const, "aria-describedby": errId(k) } : {});
  const err = (k: PayrollErrorKey) => (shown(k) ? <p id={errId(k)} className={cn("text-xs", BAD_TEXT)} role="alert">{errors[k]}</p> : null);

  return (
    <div className="space-y-6">
      <section className="space-y-4" aria-labelledby="pulse-payroll-q">
        <div className="space-y-2">
          <p id="pulse-payroll-q" className="font-bold">Do you pay a crew or staff from your business bank?</p>
          <RadioGroup
            value={value.runsPayroll}
            disabled={disabled}
            onValueChange={(v) => onChange({ runsPayroll: v === "no" ? "no" : "yes" })}
            className="grid sm:grid-cols-2 gap-2"
            aria-labelledby="pulse-payroll-q"
          >
            {([["yes", "Yes"], ["no", "No, skip payroll"]] as const).map(([k, l]) => (
              <Label key={k} htmlFor={`pulse-runs-${k}`} className={cn(CHOICE_TILE, value.runsPayroll === k ? CHOICE_ON : CHOICE_OFF)}>
                <RadioGroupItem id={`pulse-runs-${k}`} value={k} />
                {l}
              </Label>
            ))}
          </RadioGroup>
          {value.runsPayroll === "no" && (
            <p className="text-xs text-muted-foreground">Financial Pulse won't check whether payroll is covered. You can turn this on later in Setup.</p>
          )}
        </div>

        {value.runsPayroll === "yes" && (
          <>
            <div className="space-y-2">
              <p id="pulse-payroll-accounts-q" className="text-sm font-bold">Which account does payroll come out of?</p>
              {bankAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Turn on a business bank account first to pick it here.</p>
              ) : (
                <div role="group" aria-labelledby="pulse-payroll-accounts-q" {...invalid("accounts")} className="grid gap-2">
                  {bankAccounts.map((a) => {
                    const id = `pulse-payroll-${a.id}`;
                    const checked = value.payrollAccountIds.includes(a.id);
                    return (
                      <Label key={a.id} htmlFor={id} className={cn(CHOICE_TILE, checked ? CHOICE_ON : CHOICE_OFF)}>
                        <Checkbox
                          id={id}
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={(c) => onChange({
                            payrollAccountIds: c === true ? [...value.payrollAccountIds, a.id] : value.payrollAccountIds.filter((x) => x !== a.id),
                          })}
                        />
                        <span>{accountName(a)}</span>
                      </Label>
                    );
                  })}
                </div>
              )}
              {err("accounts")}
            </div>

            <div className="space-y-2">
              <p id="pulse-frequency-q" className="text-sm font-bold">How often do you pay?</p>
              <RadioGroup
                value={value.frequency ?? ""}
                disabled={disabled}
                onValueChange={(v) => onChange({ frequency: v as PaySchedule["frequency"] })}
                className="grid grid-cols-2 gap-2"
                aria-labelledby="pulse-frequency-q"
                {...invalid("frequency")}
              >
                {PAY_FREQUENCIES.map((f) => (
                  <Label
                    key={f}
                    htmlFor={`pulse-freq-${f}`}
                    className={cn(CHOICE_TILE, value.frequency === f ? CHOICE_ON : CHOICE_OFF)}
                  >
                    <RadioGroupItem id={`pulse-freq-${f}`} value={f} />
                    {FREQUENCY_LABEL[f]}
                  </Label>
                ))}
              </RadioGroup>
              {err("frequency")}
            </div>

            {(value.frequency === "weekly" || value.frequency === "biweekly") && (
              <div className="space-y-2">
                <Label htmlFor="pulse-next-payday" className="text-sm font-bold">When is your next payday?</Label>
                <Input
                  id="pulse-next-payday"
                  type="date"
                  value={value.nextPayday}
                  disabled={disabled}
                  onChange={(e) => onChange({ nextPayday: e.target.value })}
                  className="max-w-[12rem] [color-scheme:dark]"
                  {...invalid("schedule")}
                />
              </div>
            )}

            {value.frequency === "semimonthly" && (
              <div className="space-y-2">
                <p id="pulse-semi-q" className="text-sm font-bold">Which days do you pay?</p>
                <RadioGroup
                  value={value.semiPair ?? ""}
                  disabled={disabled}
                  onValueChange={(v) => onChange({ semiPair: v as SemiPair, semiDay: v === "custom" ? value.semiDay ?? 5 : value.semiDay })}
                  className="gap-2"
                  aria-labelledby="pulse-semi-q"
                  {...invalid("schedule")}
                >
                  {([
                    ["1-15", "The 1st and the 15th"],
                    ["15-30", "The 15th and the 30th"],
                    ["15-last", "The 15th and the last day of the month"],
                    ["custom", "Other days"],
                  ] as const).map(([k, l]) => (
                    <Label key={k} htmlFor={`pulse-semi-${k}`} className={cn(CHOICE_TILE, value.semiPair === k ? CHOICE_ON : CHOICE_OFF)}>
                      <RadioGroupItem id={`pulse-semi-${k}`} value={k} />
                      {l}
                    </Label>
                  ))}
                </RadioGroup>
                {value.semiPair === "custom" && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span aria-hidden>The</span>
                      <select
                        id="pulse-semi-day"
                        aria-label="First payday of the month"
                        className={SELECT_CLASS}
                        value={value.semiDay ?? ""}
                        disabled={disabled}
                        onChange={(e) => onChange({ semiDay: Number(e.target.value) })}
                      >
                        {Array.from({ length: 13 }, (_, i) => i + 2).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
                      </select>
                      <span>and the {value.semiDay ? ordinal(value.semiDay + 15) : "..."}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">The second payday is always 15 days after the first. Pick the closest.</p>
                  </div>
                )}
              </div>
            )}

            {value.frequency === "monthly" && (
              <div className="space-y-2">
                <Label htmlFor="pulse-month-day" className="text-sm font-bold">Which day of the month?</Label>
                <select
                  id="pulse-month-day"
                  {...invalid("schedule")}
                  className={cn(SELECT_CLASS, "block")}
                  value={value.monthDay === null ? "" : String(value.monthDay)}
                  disabled={disabled}
                  onChange={(e) => onChange({ monthDay: e.target.value === "last" ? "last" : e.target.value === "" ? null : Number(e.target.value) })}
                >
                  <option value="">Choose a day</option>
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>The {ordinal(d)}</option>)}
                  <option value="last">The last day of the month</option>
                </select>
              </div>
            )}

            {paydays.length > 0 && (
              <p className="text-xs text-muted-foreground" data-pulse-paydays>
                Your next paydays: {paydays.map(formatWeekday).join(", ")}
              </p>
            )}
            {err("schedule")}

            <MoneyField
              id="pulse-typical-payroll"
              label="Typical payroll each payday (optional)"
              hint="What one payday usually costs, crew and contractors included. Leave it blank and TreeCheck works it out from your bank after a few paydays."
              value={value.typicalPayroll}
              disabled={disabled}
              onChange={(v) => onChange({ typicalPayroll: v })}
              error={showErrors ? errors.typicalPayroll : undefined}
            />
          </>
        )}
      </section>

      <section className="space-y-4 border-t border-border pt-5" aria-label="Your goal">
        <p className="font-bold">Your goal (optional)</p>
        <MoneyField
          id="pulse-profit-goal"
          label="Profit you want each month"
          hint="Your status turns yellow when the month is heading below this."
          value={value.profitGoal}
          disabled={disabled}
          onChange={(v) => onChange({ profitGoal: v })}
          error={showErrors ? errors.profitGoal : undefined}
        />
        {value.runsPayroll === "yes" && (
          <MoneyField
            id="pulse-cash-reserve"
            label="Cash to keep in the bank after payroll"
            hint="Payroll shows as tight when paying it would leave less than this."
            value={value.cashReserve}
            disabled={disabled}
            onChange={(v) => onChange({ cashReserve: v })}
            error={showErrors ? errors.cashReserve : undefined}
          />
        )}
      </section>
    </div>
  );
}

function MoneyField({
  id, label, hint, value, onChange, disabled, error,
}: {
  id: string; label: string; hint: string; value: string; onChange: (v: string) => void; disabled: boolean; error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-bold">{label}</Label>
      <div className="relative max-w-[12rem]">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm" aria-hidden>$</span>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="pl-6"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
        />
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      {error && <p id={`${id}-error`} className={cn("text-xs", BAD_TEXT)} role="alert">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Done marker used in summaries

export function DoneLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm py-2 px-3">
      <CheckCircle2 className={cn("w-4 h-4 mt-0.5 shrink-0", ok ? "text-primary" : "text-muted-foreground/60")} />
      <span className={ok ? "" : "text-muted-foreground"}>{children}</span>
    </li>
  );
}
