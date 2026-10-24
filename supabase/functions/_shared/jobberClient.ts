// TreeCheck Jobber sync: finds the customer's existing Jobber client, or creates one, plus the property
// a quote or invoice is for. Used by the draft quote (jobberQuote.ts) and the closeout invoice
// (jobberInvoice.ts). Server-side only. Maintained outside Lovable.
//
// Matching never goes by name alone (pickClient): the same email, or the same phone and last name.
// When nothing matches, the client is created with the property in the same call, and the property's
// address as the client's mailing (billing) address. An existing client's details are never changed.

import { jobberMutate, jobberRead, type JobberCallOptions } from "./jobberApi.ts";
import { pickClient, normalizeEmail, normalizePhone, splitName, type ClientCandidate, type MatchReason } from "./jobberClientMatch.ts";
import { samePlace, type Address } from "./jobberAddress.ts";
import { TC_ClientCreate, TC_ClientProperties, TC_ClientSearch, TC_PropertyCreate } from "./jobberQueries.quote.ts";

/** The customer as TreeCheck knows them. */
export interface CustomerForJobber {
  name: string | null;
  email: string | null;
  phone: string | null;
  address: Address | null;
}

/** The Jobber client (and property) to use, and how the client was found. */
export interface JobberClientRef {
  clientId: string;
  propertyId: string | null;
  match: MatchReason | "stored" | "new";
  ambiguous: boolean;
}

export interface FindClientOptions extends JobberCallOptions {
  /** A client id TreeCheck already stored for this customer. */
  storedClientId?: string | null;
  /** Whether a property is required (quotes need one; invoices don't). */
  needProperty: boolean;
}

interface SearchNode {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  isArchived?: boolean | null;
  emails?: Array<{ address?: string | null } | null> | null;
  phones?: Array<{ number?: string | null; normalizedPhoneNumber?: string | null } | null> | null;
}

interface PropertyNode {
  id: string;
  address?: {
    street1?: string | null;
    street2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
  } | null;
}

/** Jobber's address input for one of TreeCheck's parsed addresses. */
export function jobberAddressInput(a: Address): Record<string, string> {
  return {
    street1: a.street1,
    ...(a.street2 ? { street2: a.street2 } : {}),
    city: a.city,
    province: a.province,
    postalCode: a.postalCode,
    country: "United States",
  };
}

/** "(405) 555-0123" for ten digits, the way Jobber shows phone numbers. */
export function formattedPhone(digits: string): string {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** A Jobber search result in pickClient's terms. */
export function toCandidate(n: SearchNode): ClientCandidate {
  const present = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";
  return {
    id: n.id,
    firstName: n.firstName ?? null,
    lastName: n.lastName ?? null,
    companyName: n.companyName ?? null,
    isArchived: n.isArchived ?? false,
    emails: (n.emails ?? []).map((e) => e?.address).filter(present),
    phones: (n.phones ?? []).flatMap((p) => [p?.number, p?.normalizedPhoneNumber]).filter(present),
    addresses: [],
  };
}

function propertyAddress(node: PropertyNode): Address {
  const a = node.address ?? {};
  return {
    street1: a.street1 ?? "",
    ...(a.street2 ? { street2: a.street2 } : {}),
    city: a.city ?? "",
    province: a.province ?? "",
    postalCode: a.postalCode ?? "",
    country: "US",
  };
}

async function search(token: string, term: string, field: "EMAILS" | "PHONES", opts: JobberCallOptions) {
  const { data } = await jobberRead<{ clients?: { nodes?: SearchNode[] | null } | null }>(
    token, TC_ClientSearch, { term, fields: [field] }, opts,
  );
  return (data.clients?.nodes ?? []).filter((n): n is SearchNode => Boolean(n?.id)).map(toCandidate);
}

/** The customer's existing client: searched by email, then by phone, and picked by pickClient's tiers. */
async function findClient(token: string, customer: CustomerForJobber, opts: JobberCallOptions) {
  const candidates = new Map<string, ClientCandidate>();
  const add = (list: ClientCandidate[]) => {
    for (const c of list) if (!candidates.has(c.id)) candidates.set(c.id, c);
  };
  const email = normalizeEmail(customer.email);
  const phone = normalizePhone(customer.phone);
  if (email) add(await search(token, email, "EMAILS", opts));
  if (phone) {
    const byDigits = await search(token, phone, "PHONES", opts);
    add(byDigits);
    if (byDigits.length === 0) add(await search(token, formattedPhone(phone), "PHONES", opts));
  }
  if (candidates.size === 0) return null;
  return pickClient([...candidates.values()], {
    email: customer.email,
    phone: customer.phone,
    lastName: splitName(customer.name).last,
    address: customer.address,
  });
}

async function createClient(token: string, customer: CustomerForJobber, opts: JobberCallOptions) {
  const { first, last } = splitName(customer.name);
  const email = normalizeEmail(customer.email);
  const input: Record<string, unknown> = {
    firstName: first || "Homeowner",
    ...(last ? { lastName: last } : {}),
    ...(email ? { emails: [{ description: "MAIN", primary: true, address: email }] } : {}),
    ...(customer.phone?.trim() ? { phones: [{ description: "MAIN", primary: true, number: customer.phone.trim() }] } : {}),
    ...(customer.address
      ? { billingAddress: jobberAddressInput(customer.address), properties: [{ address: jobberAddressInput(customer.address) }] }
      : {}),
  };
  const { data } = await jobberMutate<{
    clientCreate?: { client?: { id?: string; clientProperties?: { nodes?: Array<{ id?: string } | null> } } | null } | null;
  }>(token, TC_ClientCreate, { input }, opts);
  const client = data.clientCreate?.client;
  if (!client?.id) throw new Error("Jobber didn't return the new client.");
  return { clientId: client.id, propertyId: client.clientProperties?.nodes?.[0]?.id ?? null };
}

/** The client's property at this address: an existing one, or a new one. Without an address, the client's only property. */
async function findOrCreateProperty(
  token: string,
  clientId: string,
  address: Address | null,
  opts: JobberCallOptions,
): Promise<string | null> {
  const { data } = await jobberRead<{ client?: { clientProperties?: { nodes?: PropertyNode[] | null } | null } | null }>(
    token, TC_ClientProperties, { id: clientId }, opts,
  );
  const nodes = (data.client?.clientProperties?.nodes ?? []).filter((n): n is PropertyNode => Boolean(n?.id));
  if (!address) return nodes.length === 1 ? nodes[0].id : null;
  const same = nodes.find((n) => samePlace(address, propertyAddress(n)));
  if (same) return same.id;
  const { data: created } = await jobberMutate<{ propertyCreate?: { properties?: Array<{ id?: string } | null> } | null }>(
    token, TC_PropertyCreate, { clientId, input: { properties: [{ address: jobberAddressInput(address) }] } }, opts,
  );
  const id = created.propertyCreate?.properties?.[0]?.id;
  if (!id) throw new Error("Jobber didn't return the new property.");
  return id;
}

/** The customer's Jobber client and property: stored, found by email or phone, or created. */
export async function findOrCreateClient(
  token: string,
  customer: CustomerForJobber,
  opts: FindClientOptions,
): Promise<JobberClientRef> {
  const call: JobberCallOptions = { signal: opts.signal, timeoutMs: opts.timeoutMs };
  let clientId = opts.storedClientId?.trim() || null;
  let match: JobberClientRef["match"] = clientId ? "stored" : "new";
  let ambiguous = false;
  if (!clientId) {
    const pick = await findClient(token, customer, call);
    if (pick?.client) {
      clientId = pick.client.id;
      match = pick.reason;
      ambiguous = pick.ambiguous;
    }
  }
  if (!clientId) {
    const created = await createClient(token, customer, call);
    return { clientId: created.clientId, propertyId: created.propertyId, match: "new", ambiguous: false };
  }
  if (!opts.needProperty && !customer.address) return { clientId, propertyId: null, match, ambiguous };
  const propertyId = await findOrCreateProperty(token, clientId, customer.address, call);
  return { clientId, propertyId, match, ambiguous };
}
