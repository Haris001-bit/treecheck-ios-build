# Jobber sync

TreeCheck's own link to Jobber: a draft quote when the owner picks a price, only free Jobber days offered to climbers, hire and booking from the approved quote, and Jobber completions marked in TreeCheck. This page is for the next developer. It covers why the work exists, the switches, the rules every Jobber call follows, the modules, and how to test and deploy.

References such as "section 2.4" point to the Jobber milestone implementation plan that Haris approved on 2026-10-08. It is kept with the engagement notes, outside this repo. "The engagement folder" below is the folder this repo is cloned into (`Mark - TreeCheck App Improvements`). Its `tools\` folder holds the PGlite test and the Jobber schema validator.

Also in this folder: `messages.md` (every text and reply the sync sends), `import-graph.json` (generated, never edited by hand) and `sql/` (the JS1 migration and its checks). The standing rules are in the repo root `AGENTS.md` and in `supabase/functions/AGENTS.md`.

## As built (2026-10-09)

The milestone shipped leaner than the plan on the rest of this page. Where they differ, this section is right.

- **Switched on for Timber on 2026-10-09:** `quotes_on_award`, `free_days`, `completion_sync` and `closeout_invoices`. The other three stay off, and what they were for (Scout-approval quotes, the history import, booking Jobber jobs, auto-hire) was not built.
- **The quote** (`_shared/jobberQuote.ts`, called by quote-pick-alert and bid-award): one draft quote per job, made on the job's first price pick or award.
  - One attempt per job. If it ends without a quote (failed, not connected, switched off), the office is told to build it, and TreeCheck never tries again by itself.
  - Jobs created before the company's `company_jobber_settings` row (written when its quotes were switched on) never get an automatic quote.
  - Progress lives in `bid_requests.quote_status`: `creating`, `pending`, `failed`, `uncertain` or `not_created`. `bid_request_quotes` and `canary_manual_rows.sql` are not used.
  - A new Jobber client gets the property's address as its mailing address. An existing client is never edited.
- **Free days** (`_shared/jobberCalendar.ts`): bid-request-create offers only free days, bid-submit refuses a climber's booked or closed day, and jobber-free-days greys those days out in the day pickers.
- **Completion** (`_shared/jobberCompletion.ts`): a JOB_ webhook for a job made from a TreeCheck quote sets Job complete once, when Jobber shows the job complete with every visit done.
- **Closeout invoices** (`_shared/jobberInvoice.ts`, called by send-closeout-to-jobber): a draft invoice in Jobber, never emailed. One per closeout: the closeout is claimed (`jobber_sync_status` `syncing`) first, and `uncertain` is never retried. Leads created before the company's `company_jobber_settings` row are skipped.
- **jobber-webhook's older TreeCheck part** (`processLegacy`): the JOB_ and INVOICE_ import runs only with `jobber_import` on, and the older hire-on-approval for QUOTE_ events only with `auto_hire` on. Both are off.

## Why this exists

Mark approved the four-item improvements proposal on 2026-10-08. Jobber goes first because it is broken today and needs nothing from Mark.

**What is broken.**
- Seven older edge functions call a Jobber API version that Jobber has retired: send-to-jobber, send-closeout-to-jobber, jobber-backfill, jobber-webhook, bid-award, bid-request-create and job-dispatch-availability.
- Since Mark connected Jobber on 2026-10-05 for Financial Pulse:
  - the automatic quote at award fails;
  - the calendar check quietly falls back to plain weekdays;
  - closing a job in Jobber never updates the TreeCheck job;
  - the automatic hire on quote approval never fires.
- Even before the version broke, there were gaps: quotes had one line item; every quote made a new Jobber client; website addresses went in as a single line; edits on the job card were ignored; approving a Scout estimate made a second quote; the climber's date pickers never looked at Jobber.

**The outcome, in Mark's terms.**
1. When the owner picks the price, a draft quote is in Jobber with line items, the AI's description and the customer's name, address, email and phone. Leslee only checks it and sends it.
2. Climbers see only days that are free on Jobber's calendar.
3. A job closed in Jobber is marked complete in TreeCheck.

**Constraints.**
- **Live app.** Timber runs its business on it.
- **Shared code.** This repo and its Supabase project are shared with Financial Pulse, which is in handover until 2026-10-28. `jobber-webhook` serves both. Pulse files are never edited from this work (the list is in `AGENTS.md`).
- **Mark's real Jobber never receives test data.** Live tests run on test company B (a sandbox company) with Haris's Jobber test account. B is deleted at the Pulse handover on 2026-10-28, so every sandbox end-to-end step runs before then.
- **The store apps run old code** (iOS from 2026-09-10, Android from 2026-07-11). Climbers and the office use the web build for this whole flow.
- **Deadline.** Everything is done and tested before Haris travels on 2026-10-29.

**Step 0** comes before any code: the schema introspection (Q0 to Q4) and the behaviour tests (T1 to T8), in the Jobber test account only. T4 decides whether TreeCheck may create jobs from quotes; if it fails, the office gets a "convert this quote" text instead. T7 records how Jobber stores visit times (an evening visit, an all-day visit and a two-day visit).

## The seven PRs

Every branch is cut from `capacitor` and merges by PR only. Lovable's bot commits to `capacitor` unprompted, so read its new commits before starting and again before deploying.

| # | Branch | What it does | Deploy |
|---|---|---|---|
| 1 | `improve/jobber-foundation` | Shared pure modules, Jobber wrapper, switch and price tables. No runtime change | JS1 migration through Lovable, then the read-back |
| 2 | `improve/jobber-old-functions` | send-to-jobber stops making quotes; closeout and backfill fixed behind switches | 3 functions |
| 3 | `improve/jobber-webhook-legacy` | The older webhook part moves to `legacy.ts`: bounded, never throws, links quotes and jobs, completion | jobber-webhook alone, then a 24-hour Pulse watch |
| 4 | `improve/jobber-quotes` | Draft quote at the first of price pick or award; client and property matching; Retry and Link | bid-award, quote-pick-alert, jobber-quote-retry |
| 5 | `improve/jobber-free-days` | Calendar cache; free days in the offered dates; server checks when a climber picks | jobber-free-days, bid-request-create, bid-submit, bid-climber-dates |
| 6 | `improve/jobber-hire-booking` | Hire once days are confirmed; booking from the quote; hourly `jobber-reconcile` | 6 functions |
| 7 | `improve/jobber-ui` | Date pickers, the Jobber line on the job card, honest copy, the job-card date-wipe fix | Publish with Mark's OK, then the store build |

New edge functions: jobber-quote-retry (PR 4), jobber-free-days (PR 5) and jobber-reconcile (PR 6).

PR 1 changes no runtime. No edge function and no web app file imports the new modules (`guards.test.ts` proves both), so its only deploy is the JS1 migration. Server PRs are proven before merge by tests and review with every switch off; live proof follows on test company B.

## Switches and the kill switch (section 2.4)

The switches live in `company_jobber_settings`, one row per company, keyed by the owner's id (`contractor_id`). Every switch defaults to `false` and a company with no row has every switch off. Only Haris changes them, from the SQL editor, never from the app or a function.

| Switch | Off (default) | On |
|---|---|---|
| `quotes_on_award` | Price saved; row marked `manual`; today's texts | Draft quote at the first of pick or award; reuse, link or retry |
| `auto_hire` | Approval recorded; office texted to tap Hire | bid-hire runs, outside quiet hours |
| `book_jobs` | Office text: "schedule it in Jobber (automatic booking is off)" | Job created from the quote, an existing job adopted, or the office texted |
| `completion_sync` | Nothing changes | Approval sets Quote accepted and completion sets Job complete, both conditional and once |
| `free_days` | Date logic identical to today | Busy, committed and closed days removed; checked at pick time; `jobber-free-days` answers |
| `jobber_import` | INVOICE_ events and unlinked JOB_ events ignored; backfill switched off | The fixed import runs |
| `closeout_invoices` | Skipped (if connected) | Draft invoice, never emailed |

The same row holds the company's settings: `busy_visits_per_day` (Jobber visits before a day counts as busy, 1 to 20, default 1), `timezone` (default America/Chicago), `default_province` (the two-letter state for addresses that have none), `quote_template` (read by `quoteBuilder.ts`) and `change_note`.

- **Linking** runs when any of `quotes_on_award`, `auto_hire`, `book_jobs` or `completion_sync` is on.
- **Kill switch.** The Lovable secret `TC_JOBBER_KILL=1` turns every company's switches off without a redeploy:
  - the older webhook part makes zero calls;
  - the reconcile exits;
  - new awards get `manual` rows.

  Only the value `1` counts (spaces around it are ignored). Delete the secret, or set it to anything else, to go back to the per-company switches.
- **Preconditions.**
  1. PR 7 is published before any switch goes on for Timber.
  2. `auto_hire` and `book_jobs` stay off everywhere, B included, until PR 6 is deployed.
  3. `book_jobs` creates jobs only if Step 0 test T4 passes. Otherwise it sends the office "convert this quote" texts.
- **Timber's first quote switch.** Run `sql/canary_manual_rows.sql` on the morning `quotes_on_award` first goes on for Timber, before switching it on (see JS1 below).

**In code** (`_shared/jobberSwitches.ts`). `jobberSwitches(admin, ownerId)` returns the seven switches in camelCase plus `busyVisitsPerDay`, `timezone`, `defaultProvince` and `quoteTemplate`. It returns `SWITCHES_OFF` for the kill switch (checked first, without touching the database), an empty owner id, a missing row, a read error or a missing table (a function deployed before the migration), and it never throws. An unknown time zone name becomes America/Chicago, and `busy_visits_per_day` is held to 1 to 20.

## Time limits and the token rule (section 2.5)

**The token rule.**
- `tokenFor` (which is `getJobberToken` from `_shared/jobber.ts`, always called with the company owner's id) runs to completion before any time budget starts. Jobber rotates refresh tokens, so a refresh cut short can lose the new token and disconnect the company.
- Budgets are enforced only as AbortSignals on Jobber GraphQL fetches: `deadline(ms)` in `jobberApi.ts`, created after `tokenFor` returns and passed as `signal`.
- Nothing ever runs `Promise.race` on a chain that contains `getJobberToken`.
- Where a caller must stop waiting (the calendar refresh), the work runs under `EdgeRuntime.waitUntil`, so the rotated token is always saved.

**Uncertain mutations.** If a deadline passes after a mutation was sent, the step is marked uncertain (`quote_state` stays `creating` and `quote_uncertain=true`), never `failed`. Every later attempt reconciles before creating anything.

**How `jobberApi.ts` reports outcomes.** `jobberRead` retries THROTTLED, HTTP 429 and 5xx (two extra attempts by default, with backoff) and throws `JobberCallError`. With `retryOn: "throttle"` it retries only THROTTLED and 429, the rule for the older webhook part (section 2.1, rule 3), so PR 3's `legacy.ts` passes `{ retries: 1, timeoutMs: 8000, retryOn: "throttle" }`. `jobberMutate` is never retried and throws one of two errors:
- `JobberDefiniteError`: Jobber certainly did not run it (nothing was sent, HTTP 4xx including 429, THROTTLED, GraphQL errors with no `data` key and no path into the result, which are parse and validation errors, a reply with neither data nor errors (an empty payload included), or `userErrors`). Safe to try again later.
- `JobberUncertainError`: Jobber may have run it (HTTP 5xx, a timeout, abort or network error once the request was on its way, an unreadable reply, or GraphQL errors that came with a `data` key, `"data": null` included, or that point at a field of the result; the GraphQL spec, section 7.1.2, sends `data` once execution has started). Never resend it; read Jobber first.

Mutation payloads select ids and numbers only, so a reply cannot fail on a field after Jobber saved the record. `shortJobberError` gives one plain line of at most 200 characters. It keeps the "not found in Jobber", "No Jobber token connected" and "reconnect" markers that jobber-webhook's retry check looks for, never says "pulse: " and never contains a token. Every call sends `TC_JOBBER_VERSION` (2026-09-25), and Jobber's versioning warning is logged once per isolate.

**Budgets.**

| Where | Budget |
|---|---|
| bid-award quote work | 40 s |
| quote-pick-alert | 40 s, in `waitUntil` after an immediate reply |
| Older webhook part | 25 s |
| Climber- and office-facing calendar checks | 6 s, at most one retry |
| bid-request-create called with the service role | 3 s |
| Calendar refresh | 20 s, in `waitUntil` |
| jobber-reconcile | 100 s per run |
| job-dispatch-availability | Replies first; booking runs in `waitUntil` |

## How each change fails safe (section 2.6)

| Failure | Result |
|---|---|
| Switch read fails or table missing | All switches off |
| No token, or a reconnect is required | Today's "not connected" path, plus office text M16 once a day while any switch is on |
| Calendar fails or times out | Cached data up to 15 minutes old; otherwise weekdays minus closed days and commitments. Pick-time checks fail open, and the office text is flagged |
| Quote creation fails for certain | `failed`; the text gives the reason; the Try-again button |
| Quote creation uncertain | Stays `creating`; the text says "check Jobber"; reconcile first |
| Booking fails | `job_state='failed'` plus an office text; the reconcile retries |
| Older webhook part fails | Outcome `tc: deferred`; Pulse runs; the reconcile repairs within the hour |
| Function deployed before the migration | Switches read as off; the price save is caught and ignored |

Message ids such as M16 are defined in `messages.md`.

## Modules (section 4)

**Conventions.**
- New modules live in `supabase/functions/_shared/`. They are TreeCheck's and are maintained outside Lovable (`AGENTS.md`).
- Pure modules use no Deno globals, no network, no clock and no randomness (today and now are parameters), so the edge functions and vitest run the same file. `guards.test.ts` checks this: no `Deno`, `fetch`, `Date.now`, `new Date()`, `Math.random` or `EdgeRuntime`.
- Jobber data reaches the pure modules through small input types, never as raw GraphQL results. The PR that adds each query maps Jobber's reply into them, once Step 0's introspection confirms the field names.
- From Financial Pulse's `_shared/jobber.ts`, TreeCheck imports only `getJobberToken`, `JobberGraphqlError`, `JobberReconnectRequired`, `JOBBER_GRAPHQL_URL` and `ownerIdOf`. `guards.test.ts` checks that all five still exist, and that no new module imports any other name from `jobber.ts`, imports all of it, or imports anything from `_shared/pulse/`. Only `jobberApi.ts` uses Jobber's address.
- GraphQL documents are split by consumer (`jobberQueries.<consumer>.ts`), so a later PR never changes the webhook's import graph. That graph is frozen after PR 3.
- The large-company setup (2026-10-26) follows the same rule: `jobberQueries.production.ts` and `productionJobber.ts` are reached from jobber-webhook only through the `production-jobber` function, called over HTTP with the service key after a one-query check, so the webhook imports none of them.
- The approval extras (2026-10-27) are `jobberQueries.extras.ts` and `productionJobberExtras.ts`: the permission check, service and team matching, the five quote fields and Jobber requests. They need Users, Requests, Products & Services and Custom Fields, which the Jobber app gets only after Jobber's review, so they stay off until `production_rollout.jobber_extras` is true. The webhook imports neither.
- The web app imports no `_shared` file, so no shared change needs a Publish.

**In the repo after PR 1.** Nothing deployed imports them yet.

| File | Kind | Contents |
|---|---|---|
| `jobberApi.ts` | IO | `TC_JOBBER_VERSION`; `tokenFor`; `jobberRead`; `jobberMutate`; `JobberCallError`, `JobberDefiniteError`, `JobberUncertainError`; `deadline(ms)`; `throttleOf(extensions)`; `shortJobberError` |
| `jobberSwitches.ts` | IO | `jobberSwitches(admin, ownerId)`, `SWITCHES_OFF`, `killSwitchOn()` |
| `tcNotify.ts` | IO | `companyMode(admin, ownerId)` (`profiles.is_sandbox`: "live", "sandbox", or "unknown" when it can't be read); `quietCompany` (true unless live); `notifyCtx(admin, ownerId, fn)` (the company part of every message's ctx: quiet unless live, `sandbox` only when confirmed; spread it and add `kind` and `role`); `officeContacts` (owner plus active team members who are not crew accounts, or the owner alone when crew accounts can't be read); `sendSms`, `sendPush` and `sendEmail` behind the quiet guard, which fails closed: only `quiet: false` sends, and a quiet send logs `[tc-quiet] fn kind role` with the text for a confirmed sandbox and only the text's length otherwise, never the destination. Every send strips em and en dashes and never throws. `sendSms` texts a US number as +1 and its ten digits (an extension dropped) or a number written with its own `+`. `alertOnce(admin, requestId, key, fn)` goes through JS1's `tc_alert_once` and logs a job with no `bid_request_quotes` row. Kept apart from `crewRecipients.ts` so the webhook never depends on a Lovable-edited file |
| `freeDays.ts` | pure | `todayIn`, `localDateOf`, `addDays`, `weekdayOf`, `daysBetween`, `busyDayCounts(visits, tz, {excludeJobIds, from, to})`, `dayStatuses` (past, closed, busy, unknown, free; a day in `lockedDates`, the one the job's ground crew is hired for, reads free even when closed or busy), `pickOfferedDates`, `validatePickedDates`, `inQuietHours(tz, now)` (21:00 to 07:00), `climberDatesPending` (section 0.17), `WANTS_SITE_VISIT` |
| `jobberAddress.ts` | pure | `parseUsAddress`, `addressKey`, `samePlace`, `jobCardAddress`, `customerDetails` (precedence below), `NO_STREET_REASON` |
| `jobberClientMatch.ts` | pure | `normalizePhone`, `normalizeEmail` (the bare address, also from `<jo@x.com>`, `Jo Smith <jo@x.com>`, `mailto:` or a trailing `.`, `;` or `,`), `splitName`, `pickClient` (reason `email_phone`, `email`, `phone_name`, `name_address` or `none`; flags ambiguity; skips archived clients; never matches on a name alone) |
| `quoteBuilder.ts` | pure | `DEFAULT_QUOTE_TEMPLATE`, `quoteTemplateFrom`, `stripPrices`, `cleanAiOverview` (at most 1,500 characters), `buildQuoteLineItems` (the priced lines add up to the sale price to the cent), `quoteTitle` |
| `jobberStatus.ts` | pure | `mapQuoteStatus` (pending, approved or archived for `bid_requests.quote_status`; the detailed value goes to `bid_request_quotes.jobber_quote_status`), `OPEN_WORKFLOW`, `CLOSED_WORKFLOW`, `isOpenWorkflow`, `completionDecision` (complete, cancelled, record_only or noop), `visitDateMatch(visits, date, tz)` (with `unreadable`, the visits given a start that can't be read) |
| `jobberBooking.ts` | pure | `bookingPlan({quote, link, request, dispatches, switches})`: wait, book(date), office_books(reason), scheduled, needs_date_change, converted_adopt or skip |

**Arriving in PRs 2 to 7.**

| File | Kind | PR | Contents |
|---|---|---|---|
| `jobberImport.ts` | pure + IO | 2 or 3 | The fixed old lead and closeout import |
| `jobberQueries.import.ts` | pure | 2 or 3 | `TC_Invoice`, `TC_JobsPage` (sorted by `UPDATED_AT`), `TC_InvoiceCreate` |
| `jobberQueries.webhook.ts` | pure | 3 | `TC_QuoteState`, `TC_JobState`, `TC_Account`. Frozen after PR 3 |
| `jobberLinks.ts` | IO | 3 | `findRequestByQuote` and `findRequestByJob` (owner-scoped, `limit(2)`); `linkJob` (conditional; while `job_state='booking'` it only fills `jobber_job_id`); `clearQuoteLink`; `claimLease` |
| `jobberHire.ts` | IO | 3 | `maybeHire(admin, requestId, reason)`: calls bid-hire only when `auto_hire` is on, the quote is approved or converted, a crew is awarded, `hired_at` is null, and (for automatic reasons) it isn't quiet hours |
| `jobber-webhook/legacy.ts` | IO | 3 | `companyOf`; `processLegacy` (same signature as today's older part) |
| `jobberQueries.quote.ts` | pure | 4 | `TC_ClientSearch`, `TC_ClientProperties`, `TC_ClientQuotes` (newest first), `TC_ClientCreate`, `TC_PropertyCreate`, `TC_QuoteCreate`, `TC_QuoteByNumber` |
| `jobberQuote.ts` | IO | 4 | `ensureQuoteForRequest` |
| `jobberQueries.calendar.ts` | pure | 5 | `TC_BusyVisits`: Pulse's visits shape plus `endAt`, `allDay`, `job{id}`, `first:100` |
| `jobberCalendar.ts` | IO | 5 | `calendarFor(admin, ownerId, {from, days, excludeRequestId, budgetMs, optional})`: cache first, single-flight refresh in `waitUntil`, plus TreeCheck's own commitments |
| `jobberQueries.booking.ts` | pure | 6 | `TC_JobFromQuote` (shape set by Step 0 test T4) |
| `jobberBookingRun.ts` | IO | 6 | `bookFor(admin, requestId, {trigger})`: reads the inputs, calls `bookingPlan` and carries out the action |

The plan lists `jobberImport.ts` and `jobberQueries.import.ts` among PR 3's files, but PR 2's jobber-backfill already uses `jobberImport` and its closeout invoice needs `TC_InvoiceCreate`, so both land with whichever PR needs them first. A PR that adds a module also adds it to the guards (below).

**Customer details and address precedence** (built in `jobberAddress.ts`, used by the quote from PR 4):
- Name and phone: the job card (`bid_requests.customer_*`), then the capture, then the lead.
- Email: the capture, then the lead (decision D4).
- Address:
  1. If the job-card line normalises to the same text as the capture's combined fields, use the capture's structured fields.
  2. Otherwise parse the job-card line, with hints from `request.city`, the capture's state and zip, and `default_province`.
  3. Then the capture, then `lead.customer_address`.

  With no street anywhere, `jobCardAddress` gives null and the quote fails with `NO_STREET_REASON`: "No street address on the job: add it with Edit job details."

Blank values and stand-ins such as "Homeowner", "Unknown" or "n/a" count as missing, so the next source is used.

### Two failure styles: freeDays and visitDateMatch

- **`freeDays.ts` fails loudly by design.** An invalid date, a fractional day count, an invalid `Date`, or a Jobber time without its zone ("Z" or "+hh:mm") throws, because a wrong day must never be shown as free or busy. The caller catches it and takes the calendar fallback in section 2.6 (cached data up to 15 minutes old, otherwise weekdays minus closed days and commitments). The climber's own picks are the exception: `validatePickedDates` rejects a string that is not a date with the reason `invalid` instead of throwing, and only an invalid `today` throws.
- **`jobberStatus.visitDateMatch` never throws on Jobber data.** A visit with no start is unscheduled. A start that was given but can't be read (no zone, a date alone, not a time) covers no day and is counted in `unreadable`; an unreadable end reads as the start day; a missing or malformed date never matches. When no visit matches and `unreadable` is above 0, `bookingPlan` skips (`visits_not_read`) instead of texting the office M9, so a mapping bug fails safe. The webhook's older part uses it from PR 3, and one malformed visit must not stop the webhook. It reads days exactly as `busyDayCounts` does, from a private copy rather than an import, because the webhook's import graph is frozen after PR 3. Give it the zone from `jobberSwitches`, which is always one the runtime knows: Intl throws on an unknown zone name.

### freeDays.ts and the plan

The header of `freeDays.ts` records no deviation from the plan. It goes further than the plan's one-line summary in five ways:
- `pickOfferedDates` is never empty while the window holds a day from today on, and it offers weekends only when nothing else is left. Its order: free weekdays; weekdays with no Jobber data (unknown); any open weekday (every weekday busy, today's fallback); open weekend days (a company closed every weekday); any day from today on. The caller starts the window tomorrow, as bid-request-create does today.
- `validatePickedDates` also refuses closed and busy days found in the statuses. A date outside the statuses is kept unchecked (pick-time checks fail open), so build the statuses over every picked date.
- `busyDayCounts` takes optional `from` and `to` days so one very long visit stays bounded. A visit ending exactly at local midnight leaves the next day free, completed and unscheduled visits never count, and all-day visits are read like timed ones until Step 0 test T7 shows how Jobber stores them.
- It also exports `climberDatesPending` (section 0.17: the awarded climber still owes their days) and the `WANTS_SITE_VISIT` marker.
- `dayStatuses` takes `lockedDates`: the day the job's ground crew is already hired for. Unless past, it reads free even on a closed weekday or a busy day. That is section 8's one exception to closed weekdays winning, and it lets the climber keep that day, which bid-climber-dates insists on. PR 5 passes the filled call-out's `awarded_date`.

## Tests and guards

Run everything from the repo root. The repo's own dependencies are enough.

```sh
npm test                                   # the whole suite (vitest run)
npm test -- src/lib/jobberSync             # the Jobber sync suites only
npx tsc --noEmit -p tsconfig.app.json      # type check; the suites pull the _shared modules in
npx eslint <changed files>
npm run build
```

Where `npm` or `npx` is not on the PATH, call the tools directly:

```sh
node node_modules/vitest/vitest.mjs run src/lib/jobberSync
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
node node_modules/eslint/bin/eslint.js <changed files>
```

From PR 2 on, every PR also runs `deno check` on each changed function and the query validator (below).

**The suites** in `src/lib/jobberSync/` use synthetic data only. `fetch` and the Supabase client are stubbed, and nothing calls Jobber, Supabase, Twilio or n8n.

| Suite | Covers |
|---|---|
| `freeDays.test.ts` | Local days across daylight saving, busy counts, day statuses, offered and picked dates, quiet hours, `climberDatesPending` |
| `jobberApi.test.ts` | Read retries, definite and uncertain mutation failures, short error text, no token in any error |
| `budget.test.ts` | The token rule: the token finishes before any budget starts, budgets are only AbortSignals, nothing races the token, and a budget that runs out after sending leaves the mutation uncertain |
| `switches.test.ts` | Kill switch, missing row, read error and missing table all mean every switch off; the read never throws |
| `tcNotify.test.ts` | The quiet guard (it fails closed, only a confirmed sandbox's log holds the text, and no log holds the destination), the sandbox check and `notifyCtx`, the Twilio, send-push and Gmail connector calls, US numbers and extensions, office contacts (no crew accounts), `alertOnce` |
| `jobberStatus.test.ts` | Quote status mapping, the workflow lists, `completionDecision`, `visitDateMatch` |
| `booking.test.ts` | Every row of the `bookingPlan` table (section 6, PR 6), plus the switches, missing data and visit times that can't be read |
| `guards.test.ts` | The rules below, read from the source files |
| `address.test.ts` | The one-line address parser, address comparison, and the customer details and address precedence |
| `clientMatch.test.ts` | Phone, email and name normalising, and `pickClient`'s tiers, ambiguity and archived clients |
| `quoteBuilder.test.ts` | The quote's title, line items (priced lines add up to the cent, `taxable`) and the cleaned AI overview |

**Guards in PR 1** (`guards.test.ts`). They read the source files, so an edit that breaks a rule fails `npm test`.
- The five `jobber.ts` exports TreeCheck uses still exist, with their shapes.
- `NEW` lists exactly the TreeCheck Jobber modules in `_shared` (every `jobber*.ts` except Pulse's `jobber.ts`, plus `freeDays.ts`, `quoteBuilder.ts` and `tcNotify.ts`), so a module added or renamed without joining it fails the suite instead of escaping the checks below.
- Each of the nine new modules contains no retired API version, no old quote input type and no old cost field, names no Financial Pulse table, and never names `jobber_tokens` (tokens come only through `getJobberToken`).
- Each takes from `_shared/jobber.ts` only the five names above (never all of it, a default import or a dynamic import) and nothing from `_shared/pulse/` (section 2.1). The check is itself tested on a sample of every way past it.
- Among them, only `jobberApi.ts` uses Jobber's GraphQL address.
- The six pure modules use no Deno globals, no `fetch`, no clock (`Date.now`, `new Date()`), no `Math.random` and no `EdgeRuntime`.
- No edge function imports a new module, directly or through another file (`MAY_IMPORT_NEW` is empty in PR 1), and no web app file imports a Jobber sync module.
- `import-graph.json` is current, the manifest covers every function and follows imports through other files, and the import reader and the deploy list behave as documented.

The banned strings are built from pieces inside the test (`RETIRED_VERSION`, `OLD_INPUT_TYPE`, `OLD_PRICE_FIELD`). This README describes them rather than quoting them, so a guard that scans every file can include it.

**Guards that join later PRs** (the guard list in section 10). They cannot pass yet because the code they protect is still the old code. Each joins `guards.test.ts` with the PR named:

| Guard | Joins |
|---|---|
| No file anywhere contains the retired API version | PR 2, with an allowance list of the old functions not fixed yet (jobber-webhook, bid-award, bid-request-create, job-dispatch-availability). PRs 3 to 6 each remove the functions they fix; after PR 6 the list is empty |
| Only `_shared/jobber.ts` and `_shared/jobberApi.ts` fetch Jobber's GraphQL address | Same path as the line above: today the seven old functions fetch it themselves |
| No old quote input type and no old cost field anywhere | PR 2 (send-to-jobber, send-closeout-to-jobber), with bid-award allowed until PR 4 |
| send-to-jobber contains no `quoteCreate` | PR 2 |
| jobber-webhook's `index.ts` keeps the invariants in section 2.1 | PR 3 |
| `legacy.ts` touches no Financial Pulse table, Pulse's settings table included | PR 3 |
| Every `jobCreate` document carries the quote link | PR 6 (`jobberQueries.booking.ts`; job-dispatch-availability has its own `jobCreate` until then) |
| The reconcile kick line exists | PR 6 (jobber-reconcile) |

Every PR also adds its new modules to `NEW` (and the pure ones to `PURE`), so the per-module checks cover them, and adds the functions it deploys to `MAY_IMPORT_NEW`. The coverage check fails until a new module is listed. PR 3 also runs the Pulse import check on `jobber-webhook/legacy.ts`.

## Notes for later PRs (from the PR 1 review)

- **`alertOnce` (PR 3 and PR 6).** Create the job's `bid_request_quotes` row (an upsert) before alerting: with no row, `tc_alert_once` returns null and the alert is only logged as not sent. The key is stamped before the send, so a Twilio outage uses it up. Let the send report whether anything went out, and add a release (for example a service-role `tc_alert_release(job, key)`) so the reconcile can try again.
- **Mutations (PR 4 and PR 6).** `jobberMutate` returns success when the payload's record is null and `userErrors` is empty. Treat a missing id as uncertain and read Jobber before anything else.
- **Tokens (PR 3 on).** `tokenFor` can throw `JobberReconnectRequired` or a plain `Error` as well as return null. All three take the not-connected path in section 2.6.
- **Jobber's error details (PR 3).** `JobberCallError` keeps Jobber's messages but not their paths or codes. To tell "quote not found" from a permission error, keep a scrubbed copy of the errors, as Pulse's `JobberGraphqlError` does.
- **Day-pick call-outs (PR 6).** An open day-pick call-out whose offered days have all passed makes `bookingPlan` wait forever, so M8 never goes out. The reconcile needs a rule for it.
- **The sandbox check (every PR that sends).** Build every message's ctx with `notifyCtx`, never `quiet` from a row by hand.
- **M2's recipients (PR 4).** `messages.md` records that M2 keeps bid-award's own list for now.

## AGENTS.md rules that later PRs add

Lovable's bot treats `AGENTS.md` as standing orders, so every line must be true the moment it merges. PR 1 adds only the four rules that are already true: switches change only in the SQL editor, only bid-hire sets `hired_at`, no price columns on `bid_requests`, and the files maintained outside Lovable. Each rule below goes into the repo root `AGENTS.md` in the PR that makes it true, in the same one-line "rule, because reason" style:

| PR | Rule to add |
|---|---|
| PR 6 (the last of the seven older functions moves; until then some still call Jobber themselves) | TreeCheck's own Jobber calls go only through supabase/functions/_shared/jobberApi.ts (Financial Pulse keeps its own in _shared/jobber.ts and _shared/pulse/), because seven functions that each pinned their own Jobber API version all used one that does not exist, and this one wrapper holds the version, the token rule and the rule never to resend a change Jobber may already have made. |
| PR 3 and PR 6 | workflow_status is written from Jobber only by supabase/functions/jobber-webhook/legacy.ts and jobber-reconcile, only as quote_accepted and job_complete, conditionally and once, and never reverted, because a status the office set by hand must never be overwritten by a replayed, late or reopened Jobber event. (Add it in PR 3 naming legacy.ts, and extend it to jobber-reconcile in PR 6.) |
| PR 4 | Jobber quotes are created only by supabase/functions/_shared/jobberQuote.ts, called from bid-award, quote-pick-alert and jobber-quote-retry after claiming the job's bid_request_quotes row, and send-to-jobber never creates quotes, because that claim is what stops a price pick, an award, a retry and a Scout approval from each making a quote for the same job. |
| PR 5 | Climber days are checked on the server against Jobber and the company's closed weekdays; the office may override a refused day, climbers may not, and a refusal is an HTTP 200 reply with an error, because checks in the app can be bypassed and the date screens (ConfirmClimberDates) lose the error text on any 4xx reply. Also in PR 5: extend the closed-weekday sentence in `supabase/functions/AGENTS.md` to name bid-submit and bid-request-create. |
| PR 6 | Jobber jobs are created only from an approved quote, by supabase/functions/_shared/jobberBookingRun.ts after it reads the quote's jobs (quote.jobs), because a quote the office already converted in Jobber must be adopted, never booked a second time. |

## Import graph and deploy list

A shared file reaches users only when every function that imports it is redeployed. `scripts/jobber-import-graph.mjs` walks each `supabase/functions/<name>/index.ts` through its relative imports, transitively, and lists the shared files each function pulls in. It reads static imports, re-exports, side-effect imports and dynamic imports of a fixed path, and skips `npm:`, `jsr:` and URL imports. It needs Node 18 or later and no packages.

```sh
node scripts/jobber-import-graph.mjs            # write docs/jobber-sync/import-graph.json
node scripts/jobber-import-graph.mjs --check    # exit 1 while the saved manifest no longer matches the code
node scripts/jobber-import-graph.mjs deploy-list supabase/functions/_shared/jobber.ts
git diff --name-only origin/capacitor...HEAD | node scripts/jobber-import-graph.mjs deploy-list
```

- **Write** (no arguments) regenerates `import-graph.json` and warns about imports of missing files. Commit the regenerated file with any change to what a function imports, so the PR shows it.
- **`--check`** exits 1 while the saved manifest is out of date. `guards.test.ts` makes the same comparison, so `npm test` fails too.
- **`deploy-list`** prints, one per line, every function whose own folder or import graph holds a changed path. Paths may be repo-relative, absolute or relative to `supabase/functions`, given as arguments or on standard input. It reads the current code every time, so it is never stale. A path that reaches no function is reported on standard error as `not in any edge function: <path>`: docs, web app files, and in PR 1 every new module.

Each PR's deploy list comes from `deploy-list`. Just before pasting a Lovable deploy prompt, `git fetch` and diff every function in the list, and its shared imports, against the reviewed merge commit. Stop if anything changed.

## Database change JS1 (section 5)

The files in `sql/`:

| File | What it is |
|---|---|
| `JS1_jobber_sync.sql` | The reference migration. Safe to apply twice. Touches no Financial Pulse table or function |
| `checks/precheck_JS1.sql` | Read-only, counts only. Run before applying |
| `checks/readback_JS1.sql` | Read-only catalog check after applying: one row of true or false values |
| `down/JS1_jobber_sync.down.sql` | The rollback. Export the counts in its header first |
| `canary_manual_rows.sql` | Run once, on the morning `quotes_on_award` first goes on for Timber, before switching it on |

**What JS1 adds.**
- A unique partial index on `bid_requests.jobber_quote_id` (where set), so one Jobber quote is never linked to two jobs.
- `company_jobber_settings`: the seven switches plus the company's calendar and quote settings.
- `company_jobber_state`: runtime state per company (calendar cache, throttle, reconcile, digest and alert dates). It keeps day counts only, never visit details.
- `bid_request_quotes`: one row per job with the price, the Jobber quote and job links and the office alert stamps. A Jobber job links to at most one TreeCheck job. Prices live here because invited subcontractors can read every `bid_requests` column.
- `tc_alert_once(job, key)`: stamps an office alert as sent, once per job and key, in one atomic update. Server only. For a job with no `bid_request_quotes` row it stamps nothing and returns null, which `alertOnce` logs, so every handler creates the row before it alerts.
- Access: RLS on all three tables and one SELECT policy each (the company's own rows for settings and state, `is_bid_request_owner` for the job rows). Browsers never write; `service_role` and the SQL editor do. `updated_at` triggers on settings and job rows.

**Deploy order.** This is PR 1's only deploy; no functions are deployed.
1. **Precheck.** Run `checks/precheck_JS1.sql` in Lovable > Cloud > SQL editor (TreeCheck project). `duplicate_quote_ids` and `jobs_sharing_a_quote_id` must both be 0. If either is not, stop: the unique index would fail and the migration would change nothing. `js1_tables_present` is 0 before the first apply.
2. **Apply through Lovable.** Claude drafts the deploy prompt from `sorter6-deploy-prompt.txt` (the Pulse folder's `tools\lovable`) and Haris pastes it. Lovable writes JS1 exactly as written as the next drizzle migration (expected `0036_*`, with its journal entry and snapshot) and regenerates `types.ts`, which is never edited by hand. Message Mark before the merge window.
3. **Read-back.** Run `checks/readback_JS1.sql`. `all_checks_true` and every other column must be true. Then check that `types.ts` only gained the three tables and the `tc_alert_once` function.
4. **Isolation check.** From the repo root, run Pulse's `node scripts/pulse-isolation-check.mjs`. It signs in with test logins typed at run time and requests counts only; every Pulse isolation check must still pass.
5. Log the deploy in the engagement's `CLIENT_LOG.md`.

**Rollback.** Use the down file only if the tables themselves cause a problem: switching off, `TC_JOBBER_KILL=1` and the revert PRs come first. Export the counts in its header and record them in `CLIENT_LOG.md` first, because every row in the three tables is lost. Functions deployed later keep working without the tables, since every switch then reads as off. Safe to run twice.

**Canary.** `canary_manual_rows.sql` marks every Timber job already in progress as `manual`: a price pick, a climber, ground crew or stump award (bid-submit awards the lowest stump price by itself), a hire, or a workflow status of quote sent, quote accepted or job scheduled. TreeCheck then never makes a Jobber quote by itself for a job Leslee may already have quoted; the office can still use Try again or Link. Replace the `TIMBER_OWNER_ID` placeholder in the SQL editor only and never commit a real id. Running it twice adds nothing.

**PGlite test** (`tools\pgtest` in the engagement folder, outside this repo). It runs the SQL files above against a real Postgres 17 engine inside Node, with Supabase's roles and default grants reproduced and synthetic data only. Nothing touches the live database.

```sh
cd "<engagement folder>/tools/pgtest"
npm install          # once
node test-js1.mjs    # VERBOSE=1 also prints why each refused statement was refused
```

It applies JS1 twice, checks that the read-back is all false before and all true after, checks who can read and write each table, the unique keys, the cascade, `tc_alert_once`, the canary and the rollback, and catches 28 tampered states in the read-back: 136 checks, all passing on 2026-10-09. Its own README lists every check. Add a test there for every new JS migration before it goes to Lovable.

## Database change JS2: Jobber's visit days on the Jobs calendar (2026-10-15)

Mark's Lovable added a Jobs calendar (`calendar_jobs()`, drizzle 0039) that shows the app's own dates. JS2 makes it
mirror Jobber for jobs made from a TreeCheck quote (`bid_requests.jobber_quote_id`, written by `ensureDraftQuote`).

| File | What it is |
|---|---|
| `JS2_job_jobber_days.sql` | The reference migration (expected drizzle 0040). Safe to apply twice. No Financial Pulse table or function |
| `checks/readback_JS2.sql` | Read-only catalog check after applying: one row, every column true |
| `down/JS2_job_jobber_days.down.sql` | The rollback: 0039's `calendar_jobs()` first, then the new pieces |

- **Flow.** `crew-release-holds` (every 10 minutes) starts `jobber-visit-days` on scheduled runs with the service key.
  The function replies at once, then for each company with `quotes_on_award` on: `claim_jobber_visit_days` (at most
  every 9 minutes), the linked jobs, `tokenFor`, `TC_BusyVisits` page by page (reused unchanged, up to 15 pages),
  and `replace_job_jobber_days` for the days fully read.
- **What is saved.** `job_jobber_days`: job id and local day only, never visit details. Sealed (service_role only).
- **What the calendar shows.** In the office view, a job with Jobber days shows those days instead of its award
  and ground days. Call-out (`job_dispatches`), completed and crew days are unchanged.
- **Reads only.** No Jobber writes and no texts (`guards.test.ts`). `jobber-webhook` and `_shared/jobber.ts` are untouched.
- **Module.** `_shared/jobberVisitDays.ts` (IO; tests in `src/lib/jobberSync/visitDays.test.ts`). PGlite test:
  `tools/pgtest/test-js2.mjs` in the engagement folder.

## Jobber schema validator

`tools\jobber-schema\validate-queries.mjs` in the engagement folder validates TreeCheck's Jobber GraphQL documents against a saved introspection of Jobber API version 2026-09-25. It is read-only and never calls Jobber. It has its own `package.json` (`graphql`).

```sh
cd "<engagement folder>/tools/jobber-schema"
npm install                                     # once
node validate-queries.mjs print-introspection   # the query to paste into GraphiQL
node validate-queries.mjs "../../jobber-schema/2026-10-08/full-schema.json" "../../trccai"
```

- **The schema** comes from Step 0. Run the introspection query (also saved as `introspection-query.graphql`) in GraphiQL in the Jobber test account, with the header `X-JOBBER-GRAPHQL-VERSION: 2026-09-25`, and save the raw response as `full-schema.json` in `jobber-schema\2026-10-08\` in the engagement folder. Keep it out of this repo.
- **What it checks.** Every exported `TC_*` document in `supabase/functions/_shared/jobberQueries.*.ts`. Write each one as a plain template literal; any `${}` interpolation fails the check.
- **In PR 1** there is no `jobberQueries.*.ts` file yet, so it prints "No jobberQueries.*.ts files yet. Nothing to validate." From the first PR that adds one, it runs in every PR's routine.

## Messages

`messages.md` lists every text, email line and in-app reply the sync adds or changes (section 9): the trigger, who receives it, the exact text, the PR whose code sends it, and the quiet-hours rule. Its ids (M1, C1, H1 and so on) are what `tcNotify` logs as the message kind, so they never change. No text a person reads contains an em dash or an en dash.
