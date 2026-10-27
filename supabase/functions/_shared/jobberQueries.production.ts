// Large-company setup: the documents for crew estimates sent to Jobber and the jobs made from them
// (productionJobber.ts). The quote itself is created with TC_QuoteCreate (jobberQueries.quote.ts).
// Pure: strings only, no Deno globals. Checked against Jobber API version 2026-09-25 by
// tools/jobber-schema/validate-queries.mjs in the engagement folder. Maintained outside Lovable.

/**
 * One quote: its status, its lines (an optional line's `recommended` says whether the customer kept it), the lines
 * the customer approved, and the jobs the office converted it into. A deleted quote comes back as null.
 */
export const TC_ProductionQuote = `
  query TC_ProductionQuote($id: EncodedId!) {
    quote(id: $id) {
      id quoteNumber quoteStatus title createdAt
      client { id }
      lineItems(first: 100) { nodes { id name sortOrder optional recommended textOnly } }
      approvedLines: lineItems(first: 100, filter: { approved: true }) { nodes { id } }
      jobs(first: 10) { nodes { id jobNumber } }
    }
  }`;

/** A client's quotes made since a moment, newest first, to find a quote Jobber made without confirming it. */
export const TC_ProductionClientQuotes = `
  query TC_ProductionClientQuotes($clientId: EncodedId!, $after: ISO8601DateTime!) {
    quotes(filter: { clientId: $clientId, createdAt: { after: $after } }, sort: [{ key: CREATED_AT, direction: DESCENDING }], first: 20) {
      nodes { id quoteNumber title createdAt }
    }
  }`;

/**
 * One job: its state for completion, its visits for the scheduled day, its line names (to tell which packets a job
 * covers when the quote became several jobs) and its quote with that quote's job count. A deleted job is null.
 */
export const TC_ProductionJob = `
  query TC_ProductionJob($id: EncodedId!) {
    job(id: $id) {
      id jobNumber jobStatus completedAt
      quote { id jobs(first: 10) { nodes { id } } }
      visitsInfo { incompleteTotal }
      visits(first: 30) { nodes { id startAt endAt isComplete } }
      lineItems(first: 100) { nodes { name } }
    }
  }`;

/** The job a visit belongs to. */
export const TC_ProductionVisit = `
  query TC_ProductionVisit($id: EncodedId!) {
    visit(id: $id) { id job { id } }
  }`;
