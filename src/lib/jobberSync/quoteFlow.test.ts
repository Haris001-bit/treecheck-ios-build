// Jobber milestone: the draft quote (jobberQuote.ts), the client lookup (jobberClient.ts) and the closeout
// invoice (jobberInvoice.ts). Jobber is stubbed by operation name; the database is a small fake.
import { afterEach, describe, expect, it, vi } from "vitest";
import { findOrCreateClient, formattedPhone, jobberAddressInput, toCandidate } from "../../../supabase/functions/_shared/jobberClient";
import {
  ensureDraftQuote,
  NOT_MADE_TEXT,
  officeQuoteLine,
  quoteOverview,
  quoteService,
  quoteStatusFor,
  STARTED_BEFORE_TEXT,
  toJobberLineItems,
  UNCERTAIN_TEXT,
  type QuoteJob,
} from "../../../supabase/functions/_shared/jobberQuote";
import { createCloseoutInvoice, invoiceAmount, invoiceInput } from "../../../supabase/functions/_shared/jobberInvoice";
import { NO_STREET_REASON, type Address } from "../../../supabase/functions/_shared/jobberAddress";
import { SWITCHES_OFF, type JobberSwitches } from "../../../supabase/functions/_shared/jobberSwitches";

type Handler = (vars: Record<string, unknown>) => { status?: number; body: unknown };

/** Stubs fetch: each call is answered by the handler named after its operation (TC_ClientSearch and so on). */
function stubJobber(handlers: Record<string, Handler>) {
  const calls: { op: string; vars: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body));
    const op = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?";
    calls.push({ op, vars: variables });
    const handler = handlers[op];
    if (!handler) throw new Error(`no stub for ${op}`);
    const { status = 200, body } = handler(variables);
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

const ok = (data: unknown) => ({ body: { data } });
const noClients = () => ok({ clients: { nodes: [] } });

/** Just enough of supabase-js for the quote's claim and progress updates. */
function fakeAdmin(opts: { claimRows?: unknown[]; latest?: Record<string, unknown> | null } = {}) {
  const updates: Record<string, unknown>[] = [];
  let orFilter = "";
  const admin = {
    from: (_table: string) => ({
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        const chain: Record<string, unknown> = {};
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.or = (expr: string) => {
          orFilter = expr;
          return chain;
        };
        chain.select = async () => ({ data: opts.claimRows ?? [{ id: "R1" }], error: null });
        chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve, reject);
        return chain;
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.latest ?? null }) }) }),
    }),
  };
  return { admin, updates, orFilter: () => orFilter };
}

const ON: JobberSwitches = { ...SWITCHES_OFF, quotesOnAward: true, defaultProvince: "OK", quoteTemplate: {} };
const SWITCHED_ON = Date.parse("2026-10-09T10:00:00Z");
const deps = (switches: JobberSwitches = ON, token: string | null = "tok") => ({
  switches: async () => switches,
  token: async () => token,
  quotesSince: async () => SWITCHED_ON,
  now: () => Date.parse("2026-10-09T12:00:00Z"),
  budgetMs: 5_000,
});

const job = (over: Partial<QuoteJob["request"]> = {}, rest: Partial<QuoteJob> = {}): QuoteJob => ({
  request: {
    id: "R1",
    owner_contractor_id: "OWNER",
    title: "Tree Removal",
    city: "Edmond",
    description: "Large oak over the drive.",
    customer_name: null,
    customer_phone: null,
    customer_address: null,
    needs_stump_grinding: true,
    jobber_quote_id: null,
    jobber_quote_number: null,
    quote_status: null,
    created_at: "2026-10-09T11:00:00Z",
    ...over,
  },
  capture: {
    customer_name: "Jane Q Smith",
    customer_phone: "(405) 555-0123",
    customer_email: "Jane.Smith@Example.com",
    address_street: "100 Main St",
    address_city: "Edmond",
    address_state: "OK",
    address_zip: "73034",
    final_service: "Tree Removal",
    ai_notes: "Remove one leaning oak. Lower in sections.",
  },
  lead: null,
  salePrice: 1850,
  disposalLoads: 2,
  ...rest,
});

const HOME: Address = { street1: "100 Main St", city: "Edmond", province: "OK", postalCode: "73034", country: "US" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client lookup", () => {
  it("maps Jobber's address and phone formats", () => {
    expect(jobberAddressInput(HOME)).toEqual({
      street1: "100 Main St", city: "Edmond", province: "OK", postalCode: "73034", country: "United States",
    });
    expect(formattedPhone("4055550123")).toBe("(405) 555-0123");
    expect(toCandidate({ id: "C1", emails: [{ address: "a@b.co" }, null], phones: [{ number: "405", normalizedPhoneNumber: "+1405" }] }))
      .toMatchObject({ id: "C1", emails: ["a@b.co"], phones: ["405", "+1405"], addresses: [] });
  });

  it("uses a stored client without searching when no property is needed", async () => {
    const calls = stubJobber({});
    const ref = await findOrCreateClient("tok", { name: "A B", email: null, phone: null, address: null }, { storedClientId: "C9", needProperty: false });
    expect(ref).toEqual({ clientId: "C9", propertyId: null, match: "stored", ambiguous: false });
    expect(calls).toHaveLength(0);
  });

  it("reuses the client found by email and the property at the same address", async () => {
    const calls = stubJobber({
      TC_ClientSearch: (v) => ok({
        clients: { nodes: (v.fields as string[])[0] === "EMAILS"
          ? [{ id: "C1", firstName: "Jane", lastName: "Smith", emails: [{ address: "jane.smith@example.com" }], phones: [] }]
          : [] },
      }),
      TC_ClientProperties: () => ok({ client: { id: "C1", clientProperties: { nodes: [
        { id: "P0", address: { street1: "9 Elm Ave", city: "Edmond", province: "OK", postalCode: "73034" } },
        { id: "P1", address: { street1: "100 Main Street", city: "Edmond", province: "OK", postalCode: "73034" } },
      ] } } }),
    });
    const ref = await findOrCreateClient("tok",
      { name: "Jane Smith", email: "Jane.Smith@Example.com", phone: null, address: HOME }, { needProperty: true });
    expect(ref).toMatchObject({ clientId: "C1", propertyId: "P1", match: "email" });
    expect(calls.map((c) => c.op)).toEqual(["TC_ClientSearch", "TC_ClientProperties"]);
  });

  it("adds a property when the found client has none at this address", async () => {
    const calls = stubJobber({
      TC_ClientSearch: () => ok({ clients: { nodes: [{ id: "C1", lastName: "Smith", emails: [], phones: [{ number: "405-555-0123" }] }] } }),
      TC_ClientProperties: () => ok({ client: { id: "C1", clientProperties: { nodes: [] } } }),
      TC_PropertyCreate: () => ok({ propertyCreate: { properties: [{ id: "P7" }], userErrors: [] } }),
    });
    const ref = await findOrCreateClient("tok",
      { name: "Jane Smith", email: null, phone: "405.555.0123", address: HOME }, { needProperty: true });
    expect(ref).toMatchObject({ clientId: "C1", propertyId: "P7", match: "phone_name" });
    const create = calls.find((c) => c.op === "TC_PropertyCreate");
    expect(create?.vars).toEqual({ clientId: "C1", input: { properties: [{ address: jobberAddressInput(HOME) }] } });
  });

  it("never matches a phone with a different last name, and then creates the client with its property", async () => {
    const calls = stubJobber({
      TC_ClientSearch: () => ok({ clients: { nodes: [{ id: "C2", lastName: "Jones", emails: [], phones: [{ number: "4055550123" }] }] } }),
      TC_ClientCreate: () => ok({ clientCreate: { client: { id: "C3", clientProperties: { nodes: [{ id: "P3" }] } }, userErrors: [] } }),
    });
    const ref = await findOrCreateClient("tok",
      { name: "Jane Q Smith", email: null, phone: "(405) 555-0123", address: HOME }, { needProperty: true });
    expect(ref).toEqual({ clientId: "C3", propertyId: "P3", match: "new", ambiguous: false });
    const input = calls.find((c) => c.op === "TC_ClientCreate")?.vars.input as Record<string, unknown>;
    expect(input).toMatchObject({
      lastName: "Smith",
      phones: [{ description: "MAIN", primary: true, number: "(405) 555-0123" }],
      billingAddress: jobberAddressInput(HOME),
      properties: [{ address: jobberAddressInput(HOME) }],
    });
    expect(input).not.toHaveProperty("emails");
  });

  it("tries the formatted phone when the bare digits find nobody", async () => {
    const calls = stubJobber({
      TC_ClientSearch: () => ok({ clients: { nodes: [] } }),
      TC_ClientCreate: () => ok({ clientCreate: { client: { id: "C4", clientProperties: { nodes: [] } }, userErrors: [] } }),
    });
    await findOrCreateClient("tok", { name: "Al", email: null, phone: "4055550123", address: null }, { needProperty: false });
    expect(calls.filter((c) => c.op === "TC_ClientSearch").map((c) => c.vars.term)).toEqual(["4055550123", "(405) 555-0123"]);
    const input = calls.find((c) => c.op === "TC_ClientCreate")?.vars.input as Record<string, unknown>;
    expect(input).not.toHaveProperty("billingAddress");
    expect(input).not.toHaveProperty("properties");
  });
});

describe("quote pieces", () => {
  it("picks the service and joins the description with Scout's notes once", () => {
    expect(quoteService(job())).toBe("Tree Removal");
    expect(quoteService(job({}, { capture: null, lead: { job_type: "Pruning" } }))).toBe("Pruning");
    expect(quoteOverview(job())).toBe("Large oak over the drive.\n\nRemove one leaning oak. Lower in sections.");
    expect(quoteOverview(job({ description: "Remove one leaning oak. Lower in sections. Extra." }))).toBe(
      "Remove one leaning oak. Lower in sections. Extra.");
  });

  it("sends every line with a unit price and keeps it out of saved items", () => {
    expect(toJobberLineItems([
      { name: "Tree Removal", description: "x", quantity: 1, unitPrice: 1850, taxable: false, textOnly: false },
      { name: "Stump grinding", description: "Included in the price.", quantity: 1, unitPrice: 0, taxable: false, textOnly: true },
    ])).toEqual([
      { name: "Tree Removal", description: "x", quantity: 1, unitPrice: 1850, taxable: false, saveToProductsAndServices: false },
      { name: "Stump grinding", description: "Included in the price.", quantity: 1, unitPrice: 0, taxable: false, saveToProductsAndServices: false },
    ]);
  });

  it("words each outcome for the office and the Bid Board", () => {
    expect(officeQuoteLine({ state: "created", quoteId: "Q", quoteNumber: "57", clientMatch: "new" }, 1850.4))
      .toBe("Draft quote #57 is in Jobber for $1,850, ready to check and send.");
    expect(officeQuoteLine({ state: "failed", error: "Jobber is busy (rate limit)." }, 1))
      .toBe("Couldn't make the Jobber quote: Jobber is busy (rate limit). Build it in Jobber.");
    expect(officeQuoteLine({ state: "uncertain", error: UNCERTAIN_TEXT }, 1)).toBe(UNCERTAIN_TEXT);
    expect(officeQuoteLine({ state: "off" }, 1)).toBe("Build the quote in Jobber.");
    expect(officeQuoteLine({ state: "manual", reason: STARTED_BEFORE_TEXT }, 1)).toBe(STARTED_BEFORE_TEXT);
    expect(quoteStatusFor({ state: "busy" })).toBe("pending");
    expect(quoteStatusFor({ state: "not_connected" })).toBe("not_created");
    expect(quoteStatusFor({ state: "manual", reason: NOT_MADE_TEXT })).toBe("not_created");
  });
});

describe("ensureDraftQuote", () => {
  it("reports a quote that already exists without touching anything", async () => {
    const calls = stubJobber({});
    const { admin, updates } = fakeAdmin();
    const out = await ensureDraftQuote(admin, job({ jobber_quote_id: "Q1", jobber_quote_number: "12" }), deps());
    expect(out).toEqual({ state: "exists", quoteId: "Q1", quoteNumber: "12" });
    expect(updates).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("never makes another quote after an uncertain one", async () => {
    const { admin, updates } = fakeAdmin();
    expect(await ensureDraftQuote(admin, job({ quote_status: "uncertain" }), deps())).toEqual({ state: "uncertain", error: UNCERTAIN_TEXT });
    expect(updates).toHaveLength(0);
  });

  it("does nothing while the company's switch is off", async () => {
    const calls = stubJobber({});
    const { admin, updates } = fakeAdmin();
    expect(await ensureDraftQuote(admin, job(), deps(SWITCHES_OFF))).toEqual({ state: "off" });
    expect(updates).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("backs off when another call holds the job, and reports its quote once made", async () => {
    stubJobber({});
    const busy = fakeAdmin({ claimRows: [], latest: { jobber_quote_id: null, quote_status: "creating" } });
    expect(await ensureDraftQuote(busy.admin, job(), deps())).toEqual({ state: "busy" });
    const done = fakeAdmin({ claimRows: [], latest: { jobber_quote_id: "Q2", jobber_quote_number: "9" } });
    expect(await ensureDraftQuote(done.admin, job(), deps())).toEqual({ state: "exists", quoteId: "Q2", quoteNumber: "9" });
  });

  it("claims only a job with no attempt yet, or one a crash abandoned", async () => {
    stubJobber({});
    const { admin, orFilter } = fakeAdmin();
    await ensureDraftQuote(admin, job(), deps(ON, null));
    expect(orFilter()).toBe("quote_status.is.null,and(quote_status.eq.creating,updated_at.lt.2026-10-09T11:55:00.000Z)");
  });

  it("never tries again after an attempt ended without a quote, since the office was told to build it", async () => {
    const calls = stubJobber({});
    for (const status of ["failed", "not_created", "pending"]) {
      const { admin, updates } = fakeAdmin({ claimRows: [], latest: { jobber_quote_id: null, quote_status: status } });
      expect(await ensureDraftQuote(admin, job({ quote_status: status }), deps())).toEqual({ state: "manual", reason: NOT_MADE_TEXT });
      expect(updates).toEqual([{ quote_status: "creating" }]); // the conditional claim, which matched nothing
    }
    expect(calls).toHaveLength(0);
  });

  it("leaves a job that started before the quotes were switched on to the office", async () => {
    const calls = stubJobber({});
    const { admin, updates } = fakeAdmin();
    expect(await ensureDraftQuote(admin, job({ created_at: "2026-10-08T15:00:00Z" }), deps()))
      .toEqual({ state: "manual", reason: STARTED_BEFORE_TEXT });
    expect(updates).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("reads the switch-on time from the company's settings row, and holds off when it can't tell", async () => {
    stubJobber({});
    const live = { ...deps(ON, null), quotesSince: undefined };
    const later = fakeAdmin({ latest: { created_at: "2026-10-09T11:30:00Z" } });
    expect(await ensureDraftQuote(later.admin, job(), live)).toEqual({ state: "manual", reason: STARTED_BEFORE_TEXT });
    const earlier = fakeAdmin({ latest: { created_at: "2026-10-09T10:00:00Z" } });
    expect(await ensureDraftQuote(earlier.admin, job(), live)).toEqual({ state: "not_connected" });
    const unknown = fakeAdmin({ latest: null });
    expect(await ensureDraftQuote(unknown.admin, job(), live)).toEqual({ state: "manual", reason: NOT_MADE_TEXT });
    expect(await ensureDraftQuote(earlier.admin, job({ created_at: null }), live)).toEqual({ state: "manual", reason: NOT_MADE_TEXT });
  });

  it("makes the draft quote with the customer's details and saves its number", async () => {
    const calls = stubJobber({
      TC_ClientSearch: noClients,
      TC_ClientCreate: () => ok({ clientCreate: { client: { id: "C1", clientProperties: { nodes: [{ id: "P1" }] } }, userErrors: [] } }),
      TC_QuoteCreate: () => ok({ quoteCreate: { quote: { id: "Q1", quoteNumber: 57 }, userErrors: [] } }),
    });
    const { admin, updates } = fakeAdmin();
    const out = await ensureDraftQuote(admin, job(), deps());
    expect(out).toEqual({ state: "created", quoteId: "Q1", quoteNumber: "57", clientMatch: "new" });
    expect(updates).toEqual([
      { quote_status: "creating" },
      { quote_status: "pending", jobber_quote_id: "Q1", jobber_quote_number: "57" },
    ]);
    const client = calls.find((c) => c.op === "TC_ClientCreate")?.vars.input as Record<string, unknown>;
    expect(client).toMatchObject({
      firstName: "Jane Q",
      lastName: "Smith",
      emails: [{ description: "MAIN", primary: true, address: "jane.smith@example.com" }],
      phones: [{ description: "MAIN", primary: true, number: "(405) 555-0123" }],
      billingAddress: jobberAddressInput(HOME),
      properties: [{ address: jobberAddressInput(HOME) }],
    });
    const attributes = calls.find((c) => c.op === "TC_QuoteCreate")?.vars.attributes as Record<string, unknown>;
    expect(attributes).toMatchObject({ clientId: "C1", propertyId: "P1", title: "Tree Removal in Edmond" });
    expect(attributes).not.toHaveProperty("message");
    expect(attributes).not.toHaveProperty("transitionQuoteTo");
    const lines = attributes.lineItems as Record<string, unknown>[];
    expect(lines.map((l) => [l.name, l.unitPrice])).toEqual([
      ["Tree Removal", 1850],
      ["Stump grinding", 0],
      ["Haul away wood and debris", 0],
    ]);
    expect(String(lines[0].description)).toContain("Remove one leaning oak");
    expect(lines.every((l) => l.saveToProductsAndServices === false && !("unitCost" in l) && !("textOnly" in l))).toBe(true);
  });

  it("uses the job card's own edits ahead of Scout's details", async () => {
    const calls = stubJobber({
      TC_ClientSearch: noClients,
      TC_ClientCreate: () => ok({ clientCreate: { client: { id: "C1", clientProperties: { nodes: [{ id: "P1" }] } }, userErrors: [] } }),
      TC_QuoteCreate: () => ok({ quoteCreate: { quote: { id: "Q1", quoteNumber: "1" }, userErrors: [] } }),
    });
    const { admin } = fakeAdmin();
    await ensureDraftQuote(admin, job({ customer_name: "Bob Jones", customer_phone: "405-555-0199", customer_address: "22 Oak Rd, Edmond, OK 73003" }), deps());
    const input = calls.find((c) => c.op === "TC_ClientCreate")?.vars.input as Record<string, unknown>;
    expect(input).toMatchObject({ firstName: "Bob", lastName: "Jones", phones: [{ number: "405-555-0199" }] });
    expect((input.properties as { address: Record<string, string> }[])[0].address).toMatchObject({ street1: "22 Oak Rd", postalCode: "73003" });
  });

  it("reports a missing connection and a missing street plainly", async () => {
    stubJobber({});
    const off = fakeAdmin();
    expect(await ensureDraftQuote(off.admin, job(), deps(ON, null))).toEqual({ state: "not_connected" });
    expect(off.updates.at(-1)).toEqual({ quote_status: "not_created" });

    const noStreet = fakeAdmin();
    const out = await ensureDraftQuote(noStreet.admin,
      job({}, { capture: { customer_name: "Jane Smith", address_city: "Edmond" } }), deps());
    expect(out).toEqual({ state: "failed", error: NO_STREET_REASON });
    expect(noStreet.updates.at(-1)).toEqual({ quote_status: "failed" });
  });

  it("marks the job uncertain, never failed, when Jobber may have made the quote", async () => {
    stubJobber({
      TC_ClientSearch: noClients,
      TC_ClientCreate: () => ok({ clientCreate: { client: { id: "C1", clientProperties: { nodes: [{ id: "P1" }] } }, userErrors: [] } }),
      TC_QuoteCreate: () => ({ status: 502, body: {} }),
    });
    const { admin, updates } = fakeAdmin();
    expect(await ensureDraftQuote(admin, job(), deps())).toEqual({ state: "uncertain", error: UNCERTAIN_TEXT });
    expect(updates.at(-1)).toEqual({ quote_status: "uncertain" });
  });

  it("reports Jobber's refusal as a failure the office can act on", async () => {
    stubJobber({
      TC_ClientSearch: noClients,
      TC_ClientCreate: () => ok({ clientCreate: { client: null, userErrors: [{ message: "Email is invalid", path: ["emails"] }] } }),
    });
    const { admin, updates } = fakeAdmin();
    const out = await ensureDraftQuote(admin, job(), deps());
    expect(out.state).toBe("failed");
    expect("error" in out && out.error).toContain("Email is invalid");
    expect(updates.at(-1)).toEqual({ quote_status: "failed" });
  });
});

describe("closeout invoice", () => {
  const base = {
    customer: { name: "Jane Smith", email: "jane@example.com", phone: null, address: null },
    storedClientId: "C1",
    service: "Tree Removal",
    notes: "Two oaks.",
    amount: 2400.5,
    dueDate: "2026-10-09T12:00:00.000Z",
  };

  it("checks the amount", () => {
    expect(invoiceAmount("1200.555")).toBe(1200.56);
    expect(() => invoiceAmount(0)).toThrow("above zero");
    expect(() => invoiceAmount("abc")).toThrow("above zero");
  });

  it("builds a draft invoice with one line at the sale amount, due now, never sent", () => {
    expect(invoiceInput("C1", null, base)).toEqual({
      clientId: "C1",
      subject: "Tree Removal",
      lineItems: [{ name: "Tree Removal", description: "Two oaks.", quantity: 1, unitPrice: 2400.5, taxable: false }],
      dueDetails: { dueDate: "2026-10-09T12:00:00.000Z" },
      tax: { taxCalculationMethod: "EXCLUSIVE" },
    });
    expect(invoiceInput("C1", "P1", base)).toMatchObject({ propertyId: "P1" });
  });

  it("creates it on the stored client and returns its number", async () => {
    const calls = stubJobber({
      TC_InvoiceCreate: () => ok({ invoiceCreate: { invoice: { id: "I1", invoiceNumber: 301 }, userErrors: [] } }),
    });
    expect(await createCloseoutInvoice("tok", base, 5_000)).toEqual({ clientId: "C1", invoiceId: "I1", invoiceNumber: "301" });
    expect(calls.map((c) => c.op)).toEqual(["TC_InvoiceCreate"]);
    const input = calls[0].vars.input as Record<string, unknown>;
    expect(input).not.toHaveProperty("markSent");
    expect(input).not.toHaveProperty("message");
  });
});
