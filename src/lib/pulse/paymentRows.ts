// Financial Pulse: one payment recorded in Jobber as a line in the revenue list (W3-10a). Pure, so the
// label, the amount (with or without sales tax) and the local date are tested.
import { localDate } from "../../../supabase/functions/_shared/pulse/dates";
import type { PulseRevenueRow } from "@/components/pulse/screen/pulseScreenTypes";

export interface PaymentRecord {
  jobber_payment_id: string;
  kind: string;
  received_at: string;
  amount: number | string;
  amount_pre_tax: number | string;
  invoice_number: string | null;
  jobber_job_id: string | null;
  job_number: number | null;
}

/** "Invoice #17, #1196 Large oak removal", "Deposit, ...", "Refund, ...": what the owner sees in the list. */
export function paymentLabel(p: PaymentRecord, jobLabel: string | null): string {
  const invoice = p.invoice_number ? `invoice #${p.invoice_number}` : null;
  const job = jobLabel || (p.job_number ? `#${p.job_number}` : null);
  const what = [invoice, job].filter(Boolean).join(", ");
  if (p.kind === "deposit") return `Deposit${what ? `, ${what}` : " on a quote"}`;
  if (p.kind === "refund") return `Refund${what ? `, ${what}` : ""}`;
  if (p.kind === "failed_payment") return `Bank payment that failed${what ? `, ${what}` : ""}`;
  return what ? what.charAt(0).toUpperCase() + what.slice(1) : "Payment";
}

/** The list line for a payment: the same amount rule as pulse_window_totals (M6). */
export function paymentRow(p: PaymentRecord, jobLabel: string | null, tax: string, timezone: string): PulseRevenueRow {
  return {
    id: `payment-${p.jobber_payment_id}`,
    label: paymentLabel(p, jobLabel),
    date: localDate(p.received_at, timezone),
    amount: Number(tax === "pre_tax" ? p.amount_pre_tax : p.amount),
  };
}
