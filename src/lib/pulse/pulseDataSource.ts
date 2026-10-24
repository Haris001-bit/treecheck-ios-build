// Financial Pulse: the rows behind the screen's numbers, read with the owner's own login (RLS: only
// this company's rows). "Personal, not business" goes through pulse-transaction-action.
import { supabase } from "@/integrations/supabase/client";
import { localDate, addDays } from "../../../supabase/functions/_shared/pulse/dates";
import type { PulseDataSource, PulseRevenueRow, PulseTxnRow } from "@/components/pulse/screen/pulseScreenTypes";
import { personalRuleFor, pulseErrorMessage, transactionAction } from "./api";
import { paymentRow, type PaymentRecord } from "./paymentRows";

const PAGE = 1000;
/** A bank sync was sorting when the owner changed something: give it a moment to finish. */
const settle = () => new Promise((res) => setTimeout(res, 4000));
const TXN_COLS =
  "transaction_id, account_row_id, txn_date, amount, pending, name, merchant_name, merchant_entity_id, " +
  "counterparty_name, counterparty_type, pfc_primary, pfc_detailed, treatment, category_key, exclude_reason, review";

interface TxnRecord {
  transaction_id: string;
  account_row_id: string;
  txn_date: string;
  amount: number | string;
  pending: boolean;
  name: string | null;
  merchant_name: string | null;
  merchant_entity_id: string | null;
  counterparty_name: string | null;
  counterparty_type: string | null;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  treatment: PulseTxnRow["treatment"];
  category_key: string | null;
  exclude_reason: string | null;
  review: boolean | null;
}

interface AccountRecord { id: string; name: string | null; mask: string | null; type: string | null; subtype: string | null }

function accountLabel(a: AccountRecord | undefined): string {
  if (!a) return "Account";
  const kind = a.type === "credit" ? "Card" : a.subtype ? a.subtype.charAt(0).toUpperCase() + a.subtype.slice(1) : a.name || "Account";
  return a.mask ? `${kind} ...${a.mask}` : kind;
}

// The table has no generated types for the Pulse tables in this file's view, so reads go through a narrow cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function pagedRows<T>(build: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await build(start, start + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export function createPulseDataSource(ownerId: string, timezone: string): PulseDataSource {
  let accounts: Promise<Map<string, AccountRecord>> | null = null;
  const accountMap = () => {
    accounts ??= (async () => {
      const { data, error } = await db.from("plaid_accounts").select("id, name, mask, type, subtype").eq("owner_id", ownerId);
      if (error) throw new Error(error.message);
      return new Map(((data ?? []) as AccountRecord[]).map((a) => [a.id, a]));
    })();
    return accounts;
  };

  const toRow = (t: TxnRecord, map: Map<string, AccountRecord>): PulseTxnRow => {
    const row: PulseTxnRow = {
      id: t.transaction_id,
      date: t.txn_date,
      name: t.merchant_name || t.name || "Payment",
      account: accountLabel(map.get(t.account_row_id)),
      amount: Number(t.amount),
      pending: t.pending,
      treatment: t.treatment,
      category_key: t.category_key,
      exclude_reason: t.exclude_reason,
      merchant_rule_label: null,
      review: t.review === true,
    };
    if (t.treatment === "cost" && !t.pending) {
      try {
        row.merchant_rule_label = personalRuleFor({ ...t, amount: Number(t.amount) }).merchant?.label ?? null;
      } catch {
        row.merchant_rule_label = null;
      }
    }
    return row;
  };

  const txns = async (filter: (q: ReturnType<typeof db.from>) => ReturnType<typeof db.from>, from: string, to: string) => {
    const map = await accountMap();
    const rows = await pagedRows<TxnRecord>((a, b) =>
      filter(db.from("plaid_transactions").select(TXN_COLS).eq("owner_id", ownerId).gte("txn_date", from).lte("txn_date", to))
        .order("txn_date", { ascending: false }).order("transaction_id").range(a, b));
    return rows.map((t) => toRow(t, map));
  };

  /** Payments received in [from, to] (M6, W3-10a): what revenue is when the company records payments in Jobber. */
  async function paymentRows(lo: string, hi: string, inWindow: (iso: string) => boolean, tax: string): Promise<PulseRevenueRow[]> {
    const pays = await pagedRows<Record<string, unknown>>((a, b) =>
      db.from("jobber_payments")
        .select("jobber_payment_id, kind, received_at, amount, amount_pre_tax, invoice_number, jobber_job_id, job_number")
        .eq("owner_id", ownerId).is("deleted_at", null).gte("received_at", lo).lt("received_at", hi)
        .order("received_at").order("jobber_payment_id").range(a, b));
    const jobIds = [...new Set(pays.map((p) => p.jobber_job_id as string | null).filter((x): x is string => !!x))];
    const jobs = new Map<string, string>();
    for (let i = 0; i < jobIds.length; i += 100) {
      const { data } = await db.from("jobber_jobs").select("jobber_job_id, job_number, title").eq("owner_id", ownerId).in("jobber_job_id", jobIds.slice(i, i + 100));
      for (const j of (data ?? []) as Array<Record<string, unknown>>) {
        jobs.set(j.jobber_job_id as string, `${j.job_number ? `#${j.job_number} ` : ""}${(j.title as string | null) || "Job"}`);
      }
    }
    const out: PulseRevenueRow[] = [];
    for (const p of pays) {
      if (!inWindow(p.received_at as string)) continue;
      const jobLabel = (p.jobber_job_id && jobs.get(p.jobber_job_id as string)) || null;
      out.push(paymentRow(p as unknown as PaymentRecord, jobLabel, tax, timezone));
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  return {
    costRows(categoryKey, from, to) {
      return txns((q) => {
        let r = q.eq("pending", false).in("treatment", ["cost", "refund"]);
        if (categoryKey !== null) r = categoryKey === "other" ? r.or("category_key.eq.other,category_key.is.null") : r.eq("category_key", categoryKey);
        return r;
      }, from, to);
    },
    excludedRows(reason, from, to) {
      return txns((q) => q.eq("treatment", "excluded").eq("exclude_reason", reason), from, to);
    },
    async revenueRows(from, to, basis) {
      // completed_at and received_at are instants; the window is in the company's local days, so read a
      // day around it.
      const lo = `${addDays(from, -1)}T00:00:00Z`;
      const hi = `${addDays(to, 2)}T00:00:00Z`;
      const inWindow = (iso: string) => {
        const d = localDate(iso, timezone);
        return d >= from && d <= to;
      };
      const { data: s } = await db.from("pulse_settings").select("revenue_basis, revenue_tax").eq("owner_id", ownerId).maybeSingle();
      // The same rules as pulse_window_totals (M6): without sales tax unless the company chose otherwise.
      const tax = s?.revenue_tax ?? "pre_tax";
      if (basis === "payments") return paymentRows(lo, hi, inWindow, tax);
      const jobBasis = s?.revenue_basis === "invoiced_total" ? "invoiced_total" : "job_total";
      const jobs = await pagedRows<Record<string, unknown>>((a, b) =>
        db.from("jobber_jobs")
          .select("jobber_job_id, job_number, title, job_type, billing_type, total, invoices_nonvoid_total, invoices_nonvoid_subtotal, completed_at")
          .eq("owner_id", ownerId).is("deleted_at", null).not("completed_at", "is", null)
          .gte("completed_at", lo).lt("completed_at", hi).order("completed_at").order("jobber_job_id").range(a, b));
      const visits = await pagedRows<Record<string, unknown>>((a, b) =>
        db.from("jobber_visit_revenue").select("jobber_visit_id, jobber_job_id, amount, completed_at")
          .eq("owner_id", ownerId).is("deleted_at", null).gte("completed_at", lo).lt("completed_at", hi)
          .order("completed_at").order("jobber_visit_id").range(a, b));
      const out: PulseRevenueRow[] = [];
      for (const j of jobs) {
        // The same rule as pulse_window_totals: recurring and visit-based jobs count by completed visit.
        if ((j.job_type ?? "ONE_OFF") === "RECURRING" || (j.billing_type ?? "FIXED_PRICE") === "VISIT_BASED") continue;
        if (!inWindow(j.completed_at as string)) continue;
        const total = Number(j.total ?? 0);
        const nonvoid = j.invoices_nonvoid_total === null ? null : Number(j.invoices_nonvoid_total);
        const subtotal = j.invoices_nonvoid_subtotal === null ? null : Number(j.invoices_nonvoid_subtotal);
        const amount = tax === "pre_tax" && subtotal !== null ? subtotal : jobBasis === "invoiced_total" ? (nonvoid ?? total) : (total !== 0 ? total : nonvoid ?? 0);
        out.push({
          id: `job-${j.jobber_job_id}`,
          label: `${j.job_number ? `#${j.job_number} ` : ""}${(j.title as string | null) || "Job"}`,
          date: localDate(j.completed_at as string, timezone),
          amount,
        });
      }
      const visitJobIds = [...new Set(visits.map((v) => v.jobber_job_id as string))];
      const titles = new Map<string, string>();
      for (let i = 0; i < visitJobIds.length; i += 100) {
        const { data } = await db.from("jobber_jobs").select("jobber_job_id, job_number, title").eq("owner_id", ownerId).in("jobber_job_id", visitJobIds.slice(i, i + 100));
        for (const j of (data ?? []) as Array<Record<string, unknown>>) {
          titles.set(j.jobber_job_id as string, `${j.job_number ? `#${j.job_number} ` : ""}${(j.title as string | null) || "Job"}`);
        }
      }
      for (const v of visits) {
        if (!inWindow(v.completed_at as string)) continue;
        out.push({
          id: `visit-${v.jobber_visit_id}`,
          label: `${titles.get(v.jobber_job_id as string) ?? "Recurring job"}, visit`,
          date: localDate(v.completed_at as string, timezone),
          amount: Number(v.amount),
        });
      }
      return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },
    async markPersonal(row, scope) {
      const r = await transactionAction({ action: "mark_personal", transaction_id: row.id, scope });
      if (r.ok === false) throw new Error(pulseErrorMessage(r));
      const ruleId = r.rule_id;
      if (r.pending) await settle();
      return async () => {
        const u = await transactionAction({ action: "undo", rule_id: ruleId });
        if (u.ok === false) throw new Error(pulseErrorMessage(u));
        if (u.pending) await settle();
      };
    },
    async countAsBusiness(row) {
      const r = await transactionAction({ action: "count_as_business", transaction_id: row.id });
      if (r.ok === false) throw new Error(pulseErrorMessage(r));
      if (r.pending) await settle();
    },
  };
}
