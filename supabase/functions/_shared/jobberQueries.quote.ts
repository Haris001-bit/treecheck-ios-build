// TreeCheck Jobber sync: the documents the draft quote and the closeout invoice use to find or create
// the customer's Jobber client and property, and to create the quote.
// Pure: strings only, no Deno globals. Checked against Jobber API version 2026-09-25 by
// tools/jobber-schema/validate-queries.mjs in the engagement folder. Maintained outside Lovable.

/** Client search. $fields narrows the search (EMAILS or PHONES); archived clients are left out. */
export const TC_ClientSearch = `
  query TC_ClientSearch($term: String!, $fields: [ClientSearchField!]) {
    clients(searchTerm: $term, searchFields: $fields, filter: { isArchived: false }, first: 10) {
      nodes {
        id firstName lastName companyName isArchived
        emails { address }
        phones { number normalizedPhoneNumber }
      }
    }
  }`;

/** A client's properties, to reuse one at the same address. */
export const TC_ClientProperties = `
  query TC_ClientProperties($id: EncodedId!) {
    client(id: $id) {
      id
      clientProperties(first: 20) {
        nodes { id address { street1 street2 city province postalCode } }
      }
    }
  }`;

/** Creates a client, with their property in the same call when input.properties is set. */
export const TC_ClientCreate = `
  mutation TC_ClientCreate($input: ClientCreateInput!) {
    clientCreate(input: $input) {
      client { id clientProperties(first: 5) { nodes { id } } }
      userErrors { message path }
    }
  }`;

/** Adds a property to an existing client. */
export const TC_PropertyCreate = `
  mutation TC_PropertyCreate($clientId: EncodedId!, $input: PropertyCreateInput!) {
    propertyCreate(clientId: $clientId, input: $input) {
      properties { id }
      userErrors { message path }
    }
  }`;

/**
 * Creates the draft quote. The caller never sets message (the account's default stays), quoteNumber or
 * transitionQuoteTo (the quote stays a Draft), and puts prices in unitPrice, never in the cost field.
 */
export const TC_QuoteCreate = `
  mutation TC_QuoteCreate($attributes: QuoteCreateAttributes!) {
    quoteCreate(attributes: $attributes) {
      quote { id quoteNumber }
      userErrors { message path }
    }
  }`;

/**
 * Creates a closeout's invoice. It stays a draft: the caller never sets markSent, and Jobber's API has
 * no way to email an invoice, so the office sends it from Jobber.
 */
export const TC_InvoiceCreate = `
  mutation TC_InvoiceCreate($input: InvoiceCreateInput!) {
    invoiceCreate(input: $input) {
      invoice { id invoiceNumber }
      userErrors { message path }
    }
  }`;
