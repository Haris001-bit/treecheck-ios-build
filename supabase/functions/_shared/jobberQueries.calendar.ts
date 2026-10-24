// TreeCheck Jobber sync: the calendar read behind free days (jobberCalendar.ts).
// Pure: strings only. Checked against Jobber API version 2026-09-25 by
// tools/jobber-schema/validate-queries.mjs in the engagement folder. Jobber reports each read's cost in
// extensions.cost; jobberCalendar.ts logs it.

/**
 * Visits starting in a window, oldest first, 100 per page, with the quote each visit's job was made from
 * (so a job's own visits can be left out of its calendar). Visit details never leave the function.
 */
export const TC_BusyVisits = `
  query TC_BusyVisits($after: String, $from: ISO8601DateTime!, $to: ISO8601DateTime!) {
    visits(
      first: 100
      after: $after
      filter: { startAt: { after: $from, before: $to } }
      sort: [{ key: START_AT, direction: ASCENDING }]
    ) {
      nodes { id startAt endAt allDay isComplete job { id quote { id } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
