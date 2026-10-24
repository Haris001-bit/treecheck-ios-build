// Financial Pulse screen: the rows behind a number, and "personal, not business".
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { NotCountedLine } from "../../../../supabase/functions/_shared/pulse/engine";
import { CHOICE_OFF, CHOICE_ON, CHOICE_TILE, GOOD_CHIP } from "../tone";
import {
  day,
  NOT_COUNTED_TEXT,
  notCountedWhy,
  revenueWords,
  sumCents,
  type RevenueBasis,
  type PersonalScope,
  type PulseDataSource,
  type PulseRevenueRow,
  type PulseTxnRow,
  usd,
} from "./pulseScreenTypes";

/** What a drill-down shows. */
export type DrillDown =
  | { kind: "costs"; title: string; categoryKey: string | null; from: string; to: string }
  | { kind: "review"; title: string; from: string; to: string }
  | { kind: "excluded"; title: string; reason: string; from: string; to: string; direction: "out" | "in" }
  | { kind: "revenue"; title: string; from: string; to: string; basis?: RevenueBasis }
  | { kind: "notcounted"; title: string; from: string; to: string; lines: NotCountedLine[] };

const PAGE = 25;

/** A "personal" change made while the panel is open: saving, saved (with its undo), or being undone. */
interface RecentChange {
  key: number;
  row: PulseTxnRow;
  scope: PersonalScope;
  /** Rows hidden from the list straight away (the server takes a few seconds to sort again). */
  ids: string[];
  state: "saving" | "done" | "undoing";
  undo?: () => Promise<void>;
}

const withIds = (set: Set<string>, ids: string[]) => new Set([...set, ...ids]);
const withoutIds = (set: Set<string>, ids: string[]) => new Set([...set].filter((id) => !ids.includes(id)));

export function PulseDrillDown({
  drill,
  data,
  categoryLabels,
  onOpen,
  onClose,
  onChanged,
  basis,
  withoutTax,
}: {
  drill: DrillDown | null;
  data: PulseDataSource;
  categoryLabels: Record<string, string>;
  /** What revenue is for this company (M6): changes the wording of deposits and the revenue list. */
  basis?: RevenueBasis;
  /** Revenue leaves sales tax out (the default): said under the revenue list. */
  withoutTax?: boolean;
  /** Opens another drill-down in the same panel (from the "isn't a cost" overview). */
  onOpen: (d: DrillDown) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<PulseTxnRow[] | null>(null);
  const [jobs, setJobs] = useState<PulseRevenueRow[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [failed, setFailed] = useState(false);
  const [marking, setMarking] = useState<PulseTxnRow | null>(null);
  const [version, setVersion] = useState(0);
  // Changes made while this panel is open, with their undo (the panel covers the toast). Each tap
  // shows at once; the server takes a few seconds to sort the company's payments again.
  const [recent, setRecent] = useState<RecentChange[]>([]);
  // Rows taken out of the list before the server confirms, and rows with a save running.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const seq = useRef(0);
  const drillRef = useRef(drill);
  drillRef.current = drill;
  useEffect(() => {
    setRecent([]);
    setHidden(new Set());
    setBusy(new Set());
  }, [drill]);

  const fetchList = useCallback(async (d: DrillDown): Promise<{ rows: PulseTxnRow[] | null; jobs: PulseRevenueRow[] | null }> => {
    if (d.kind === "revenue") return { rows: null, jobs: await data.revenueRows(d.from, d.to, d.basis ?? basis) };
    if (d.kind === "costs") return { rows: await data.costRows(d.categoryKey, d.from, d.to), jobs: null };
    if (d.kind === "review") return { rows: (await data.costRows(null, d.from, d.to)).filter((x) => x.review), jobs: null };
    if (d.kind === "excluded") {
      const r = await data.excludedRows(d.reason, d.from, d.to);
      return { rows: r.filter((x) => (d.direction === "in" ? x.amount < 0 : x.amount > 0)), jobs: null };
    }
    return { rows: null, jobs: null };
  }, [data, basis]);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setShown(PAGE);
    if (!drill || drill.kind === "notcounted") {
      setRows(null);
      setJobs(null);
      return;
    }
    fetchList(drill)
      .then((r) => { if (live) { setRows(r.rows); setJobs(r.jobs); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [drill, fetchList, version]);

  /** Reads the open list again after a change; keeps what is shown if that fails. */
  const reload = async () => {
    const d = drillRef.current;
    if (!d || d.kind === "notcounted") return;
    try {
      const r = await fetchList(d);
      if (drillRef.current === d) { setRows(r.rows); setJobs(r.jobs); }
    } catch { /* the list on screen stays */ }
  };

  const changeLabel = (m: { row: PulseTxnRow; scope: PersonalScope }) =>
    m.scope === "merchant" && m.row.merchant_rule_label ? `Every charge from ${m.row.merchant_rule_label}` : m.row.name;

  const undoChange = async (key: number, ids: string[], undo: () => Promise<void>, fromToast = false) => {
    setRecent((r) => r.map((m) => (m.key === key ? { ...m, state: "undoing" } : m)));
    const work = (async () => {
      await undo();
      setHidden((h) => withoutIds(h, ids));
      await reload();
      setRecent((r) => r.filter((m) => m.key !== key));
      onChanged();
    })();
    try {
      if (fromToast) {
        toast.promise(work, {
          loading: "Undoing...",
          success: "Undone. It counts as a business cost again.",
          error: (e: unknown) => (e as Error)?.message || "Couldn't undo it. Please try again.",
        });
      }
      await work;
    } catch (e) {
      setRecent((r) => r.map((m) => (m.key === key ? { ...m, state: "done" } : m)));
      if (!fromToast) toast.error((e as Error)?.message || "Couldn't undo it. Please try again.");
    }
  };

  const markAsPersonal = async (row: PulseTxnRow, scope: PersonalScope) => {
    const key = ++seq.current;
    // "Every charge from" takes that merchant's other rows in this list out too.
    const ids = scope === "merchant" && row.merchant_rule_label
      ? (rows ?? []).filter((r) => r.merchant_rule_label === row.merchant_rule_label && r.treatment === "cost" && !r.pending).map((r) => r.id)
      : [];
    if (!ids.includes(row.id)) ids.push(row.id);
    setRecent((r) => [{ key, row, scope, ids, state: "saving" }, ...r]);
    setHidden((h) => withIds(h, ids));
    try {
      const undo = await data.markPersonal(row, scope);
      setRecent((r) => r.map((m) => (m.key === key ? { ...m, state: "done", undo } : m)));
      onChanged();
      void reload();
      toast(`${changeLabel({ row, scope })} is now personal.`, {
        description: "It no longer counts as a business cost.",
        action: { label: "Undo", onClick: () => { void undoChange(key, ids, undo, true); } },
        // Sonner's own button style outranks the app's toast classes: Undo is a green link here, as in the panel.
        // The open sheet turns pointer events off outside it, so the toast turns them back on (and the sheet ignores the tap).
        classNames: { toast: "pointer-events-auto", actionButton: "!bg-transparent !text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring" },
      });
    } catch (e) {
      setRecent((r) => r.filter((m) => m.key !== key));
      setHidden((h) => withoutIds(h, ids));
      toast.error((e as Error)?.message || "Couldn't change it. Please try again.");
    }
  };

  const countAsBusiness = async (row: PulseTxnRow) => {
    setBusy((b) => withIds(b, [row.id]));
    try {
      await data.countAsBusiness(row);
      setHidden((h) => withIds(h, [row.id]));
      onChanged();
      void reload();
      toast.success("Counted as a business cost again.");
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't change it. Please try again.");
    } finally {
      setBusy((b) => withoutIds(b, [row.id]));
    }
  };

  const isList = !!drill && drill.kind !== "notcounted";
  const visibleRows = rows === null ? null : rows.filter((r) => !hidden.has(r.id));
  const list = drill?.kind === "revenue" ? jobs : visibleRows;
  const loading = isList && !failed && list === null;
  const count = list?.length ?? 0;
  const total = drill?.kind === "revenue"
    ? sumCents((jobs ?? []).map((j) => j.amount))
    : (visibleRows ?? []).reduce((s, r) => s + (drill?.kind === "excluded" ? Math.abs(r.amount) : r.amount), 0);

  const subtitle = (() => {
    if (!drill) return "";
    const range = `${day(drill.from)} to ${day(drill.to)}.`;
    switch (drill.kind) {
      case "revenue": return `${range} ${revenueWords(drill.basis ?? basis).list}${withoutTax ? " Amounts are without sales tax." : ""}`;
      case "excluded": return `${range} ${notCountedWhy(drill.reason, basis) ?? "Not a business cost."}`;
      case "review": return `${range} Money sent to an account TreeCheck can't see. It counts as a cost. If it went to your own account, mark it personal.`;
      case "notcounted": return `${range} Money that moved but isn't a business cost. Tap a line to see the payments.`;
      default: return `${range} Paid from your business bank account and card.`;
    }
  })();

  const canMark = drill?.kind === "costs" || drill?.kind === "review";
  const isPersonalList = drill?.kind === "excluded" && drill.reason === "personal";

  return (
    <>
      <Sheet open={!!drill} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          onPointerDownOutside={(e) => { if ((e.target as HTMLElement | null)?.closest("[data-sonner-toaster]")) e.preventDefault(); }}
          className={isMobile ? "max-h-[88vh] overflow-y-auto rounded-t-xl [color-scheme:dark]" : "w-full sm:max-w-lg overflow-y-auto [color-scheme:dark]"}
        >
          <SheetHeader className="text-left">
            <SheetTitle>{drill?.title}</SheetTitle>
            <SheetDescription>{subtitle}</SheetDescription>
          </SheetHeader>

          <div className="mt-4">
            {drill?.kind === "notcounted" && <NotCountedOverview drill={drill} onOpen={onOpen} basis={basis} />}

            {recent.length > 0 && (
              <div className="mb-3 rounded-lg border border-border bg-secondary/60 p-3 space-y-1.5" role="status">
                {recent.map((m) => (
                  <div key={m.key} className="flex items-center justify-between gap-3 text-sm min-h-[24px]">
                    {m.state === "undoing" ? (
                      <span className="min-w-0 inline-flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> Undoing...
                      </span>
                    ) : m.state === "saving" ? (
                      <span className="min-w-0 inline-flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-muted-foreground" />
                        <span>Saving: <span className="font-bold">{changeLabel(m)}</span> as personal...</span>
                      </span>
                    ) : (
                      <span className="min-w-0">
                        <span className="font-bold">{changeLabel(m)}</span> is now personal.
                      </span>
                    )}
                    {m.state === "done" && m.undo && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 shrink-0"
                        onClick={() => { void undoChange(m.key, m.ids, m.undo!); }}
                      >
                        Undo
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading...
              </div>
            )}
            {failed && (
              <div className="text-sm py-6">
                Couldn't load these payments.{" "}
                <Button variant="link" className="p-0 h-auto" onClick={() => setVersion((v) => v + 1)}>Try again</Button>
              </div>
            )}
            {isList && !loading && !failed && count === 0 && (
              <p className="text-sm text-muted-foreground py-6">Nothing in this period.</p>
            )}

            {drill?.kind === "revenue" && jobs && jobs.length > 0 && (
              <ul className="divide-y divide-border">
                {jobs.slice(0, shown).map((j) => (
                  <li key={j.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-bold break-words">{j.label}</p>
                      <p className="text-xs text-muted-foreground">{revenueWords(drill?.kind === "revenue" ? drill.basis ?? basis : basis).dated} {day(j.date)}</p>
                    </div>
                    <span className="font-bold tabular-nums whitespace-nowrap">{usd(j.amount)}</span>
                  </li>
                ))}
              </ul>
            )}

            {drill && drill.kind !== "revenue" && drill.kind !== "notcounted" && visibleRows && visibleRows.length > 0 && (
              <>
                {canMark && (
                  <p className="text-xs text-muted-foreground mb-1">Spot something personal? Tap "Personal, not business" under it.</p>
                )}
                <ul className="divide-y divide-border">
                  {visibleRows.slice(0, shown).map((r) => (
                    <li key={r.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold break-words">{r.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {day(r.date)} · {r.account}
                            {drill.kind === "costs" && drill.categoryKey === null && r.category_key
                              ? ` · ${categoryLabels[r.category_key] ?? "Other"}`
                              : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={"font-bold tabular-nums " + (r.amount < 0 ? "text-primary" : "")}>
                            {r.amount < 0 ? "+" : ""}{usd(Math.abs(r.amount), true)}
                          </p>
                          {r.treatment === "refund" && <Badge variant="outline" className={cn("mt-1", GOOD_CHIP)}>Refund</Badge>}
                        </div>
                      </div>
                      {canMark && r.treatment === "cost" && !r.pending && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-8 px-2 -ml-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setMarking(r)}
                        >
                          <UserRound className="w-3.5 h-3.5 mr-1" /> Personal, not business
                        </Button>
                      )}
                      {isPersonalList && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-1 h-8 px-2 -ml-2 text-xs text-muted-foreground hover:text-foreground"
                          disabled={busy.has(r.id)}
                          onClick={() => { void countAsBusiness(r); }}
                        >
                          {busy.has(r.id) ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Saving...</> : "Count as business again"}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {count > shown && (
              <div className="pt-3">
                <Button variant="outline" size="sm" onClick={() => setShown((s) => s + PAGE)}>
                  Show {Math.min(PAGE, count - shown)} more
                </Button>
              </div>
            )}

            {isList && !loading && !failed && count > 0 && (
              <div className="flex justify-between border-t border-border mt-2 pt-3 font-bold tabular-nums">
                <span>Total ({count} {drill?.kind === "revenue" ? (count === 1 ? revenueWords(drill.basis ?? basis).one : revenueWords(drill.basis ?? basis).many) : count === 1 ? "payment" : "payments"})</span>
                <span>{usd(total, drill?.kind !== "revenue")}</span>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <PersonalDialog
        row={marking}
        onCancel={() => setMarking(null)}
        onConfirm={(scope) => {
          const row = marking;
          setMarking(null);
          if (row) void markAsPersonal(row, scope);
        }}
      />
    </>
  );
}

function NotCountedOverview({ drill, onOpen, basis }: { drill: Extract<DrillDown, { kind: "notcounted" }>; onOpen: (d: DrillDown) => void; basis?: RevenueBasis }) {
  const out = drill.lines.filter((l) => l.reason !== "inflow" && l.money_out > 0);
  const deposits = drill.lines.find((l) => l.reason === "inflow");
  const row = (label: string, why: string, amount: string, onClick: () => void, positive = false) => (
    <li key={label}>
      <button type="button" onClick={onClick} className="w-full flex items-center justify-between gap-3 text-sm rounded px-2 py-3 -mx-2 hover:bg-accent transition-colors text-left group min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span>
          <span className="font-bold">{label}</span>
          <span className="block text-xs text-muted-foreground">{why}</span>
        </span>
        <span className={"flex items-center gap-1 tabular-nums whitespace-nowrap " + (positive ? "text-primary" : "")}>
          {amount} <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
        </span>
      </button>
    </li>
  );
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border">
        {out.length === 0 && <li className="text-sm text-muted-foreground py-3">Nothing in this period.</li>}
        {out.map((l) => row(
          NOT_COUNTED_TEXT[l.reason]?.label ?? l.label,
          notCountedWhy(l.reason, basis) ?? "",
          usd(l.money_out),
          () => onOpen({ kind: "excluded", title: NOT_COUNTED_TEXT[l.reason]?.label ?? l.label, reason: l.reason, from: drill.from, to: drill.to, direction: "out" }),
        ))}
      </ul>
      {deposits && deposits.money_in > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Money in</p>
          <ul>
            {row(
              NOT_COUNTED_TEXT.inflow.label,
              notCountedWhy("inflow", basis) ?? "",
              `+${usd(deposits.money_in)}`,
              () => onOpen({ kind: "excluded", title: "Deposits", reason: "inflow", from: drill.from, to: drill.to, direction: "in" }),
              true,
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function PersonalDialog({
  row,
  onCancel,
  onConfirm,
}: {
  row: PulseTxnRow | null;
  onCancel: () => void;
  onConfirm: (scope: PersonalScope) => void;
}) {
  const [scope, setScope] = useState<PersonalScope>("one");
  useEffect(() => { setScope("one"); }, [row]);
  const merchant = row?.merchant_rule_label ?? null;
  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Personal, not business?</DialogTitle>
          <DialogDescription>
            {row ? `${row.name}, ${usd(row.amount, true)} on ${day(row.date)}` : ""}. Personal spending and money you took for yourself don't count as business costs. You can undo this.
          </DialogDescription>
        </DialogHeader>
        {merchant ? (
          <RadioGroup value={scope} onValueChange={(v) => setScope(v as PersonalScope)} className="gap-2">
            <Label htmlFor="scope-one" className={cn(CHOICE_TILE, "items-start", scope === "one" ? CHOICE_ON : CHOICE_OFF)}>
              <RadioGroupItem id="scope-one" value="one" className="mt-0.5" />
              <span className="font-bold">Just this one</span>
            </Label>
            <Label htmlFor="scope-merchant" className={cn(CHOICE_TILE, "items-start", scope === "merchant" ? CHOICE_ON : CHOICE_OFF)}>
              <RadioGroupItem id="scope-merchant" value="merchant" className="mt-0.5" />
              <span>
                <span className="font-bold">Every charge from {merchant}</span>
                <span className="block text-xs text-muted-foreground">
                  Only pick this if you never buy for the business at {merchant}. Past and future charges there stop counting.
                </span>
              </span>
            </Label>
          </RadioGroup>
        ) : (
          <p className="text-sm text-muted-foreground rounded-lg border border-border p-3">
            Payments like this can go to different people, so only this one changes.
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(merchant ? scope : "one")}>It's personal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
