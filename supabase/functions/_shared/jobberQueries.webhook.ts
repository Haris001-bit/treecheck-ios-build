// TreeCheck Jobber sync: the document the webhook's TreeCheck branch reads (jobberCompletion.ts).
// Pure: strings only, no Deno globals. Checked against Jobber API version 2026-09-25 by
// tools/jobber-schema/validate-queries.mjs in the engagement folder. Maintained outside Lovable.

/**
 * One job's state, for completion. A deleted job comes back as null. jobStatus is lower case
 * (requires_invoicing, archived, active, ...); quote is the quote it was made from, if any.
 */
export const TC_JobState = `
  query TC_JobState($id: EncodedId!) {
    job(id: $id) {
      id jobNumber jobStatus completedAt
      quote { id }
      visitsInfo { incompleteTotal }
      visits(first: 20) { nodes { id isComplete } }
    }
  }`;
