// TreeCheck Jobber sync: the draft invoice in Jobber for a lead closeout (send-closeout-to-jobber).
// It goes on the customer's existing Jobber client when there is one. It stays a draft for the office to
// send: Jobber's API has no way to email an invoice, and markSent is never set.
// Server-side only. Maintained outside Lovable.

import { deadline, jobberMutate } from "./jobberApi.ts";
import { findOrCreateClient, type CustomerForJobber } from "./jobberClient.ts";
import { TC_InvoiceCreate } from "./jobberQueries.quote.ts";

export interface CloseoutInvoiceInput {
  customer: CustomerForJobber;
  /** A Jobber client id TreeCheck already stored for this customer. */
  storedClientId: string | null;
  /** The invoice's subject and line name, for example "Tree Removal". */
  service: string;
  /** The closeout's notes, shown under the line. */
  notes: string | null;
  /** The sale amount in dollars. */
  amount: number;
  /** When the invoice is due: now, so "due on receipt". */
  dueDate: string;
}

export interface CloseoutInvoice {
  clientId: string;
  invoiceId: string;
  invoiceNumber: string | null;
}

/** The closeout's amount in dollars, rounded to cents; throws when it is missing or not above zero. */
export function invoiceAmount(amount: unknown): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("The closeout needs a sale amount above zero.");
  return Math.round(n * 100) / 100;
}

/** Jobber's invoice input: one line at the sale amount, no tax rate, due now, never marked sent. */
export function invoiceInput(clientId: string, propertyId: string | null, input: CloseoutInvoiceInput): Record<string, unknown> {
  const service = input.service.trim() || "Tree work";
  return {
    clientId,
    ...(propertyId ? { propertyId } : {}),
    subject: service,
    lineItems: [{
      name: service,
      description: (input.notes ?? "").trim(),
      quantity: 1,
      unitPrice: invoiceAmount(input.amount),
      taxable: false,
    }],
    dueDetails: { dueDate: input.dueDate },
    tax: { taxCalculationMethod: "EXCLUSIVE" },
  };
}

/** Finds or creates the client, then creates the draft invoice. Throws a JobberCallError or Error on failure. */
export async function createCloseoutInvoice(
  token: string,
  input: CloseoutInvoiceInput,
  budgetMs = 40_000,
): Promise<CloseoutInvoice> {
  invoiceAmount(input.amount);
  const signal = deadline(budgetMs);
  const client = await findOrCreateClient(token, input.customer, {
    signal,
    storedClientId: input.storedClientId,
    needProperty: false,
  });
  const { data } = await jobberMutate<{ invoiceCreate?: { invoice?: { id?: string; invoiceNumber?: string | number | null } | null } | null }>(
    token,
    TC_InvoiceCreate,
    { input: invoiceInput(client.clientId, client.propertyId, input) },
    { signal },
  );
  const invoice = data.invoiceCreate?.invoice;
  if (!invoice?.id) throw new Error("Jobber didn't return the new invoice. Check Jobber before trying again.");
  return {
    clientId: client.clientId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber == null ? null : String(invoice.invoiceNumber),
  };
}
