# Jobber sync: message catalogue

Every text, email line and in-app reply that the Jobber sync adds or changes (plan section 9). Each entry gives the trigger, who receives it, the exact text, the PR whose code sends it, and the quiet-hours rule. Haris reads every new text on test company B before its PR is deployed: sandbox companies send nothing and log the full text instead.

The id in each heading (M1, C1, H1) is what `tcNotify` logs as the message kind, so ids never change. The plan has no M10.

## Rules for every message

- **Plain words, no dashes.** No em dash or en dash in any text a person reads. Use a comma or a period. `tcNotify` also strips them before sending, as a backstop.
- **Sandbox companies send nothing.** For a company with `profiles.is_sandbox`, `tcNotify` logs `[tc-quiet] <function> <id> <role> <text>`, never the phone number or email address. A company whose flag can't be read sends nothing either, and its log holds only the text's length, because a real company's texts carry customer names, phones, addresses and prices.
- **Quiet hours** are 21:00 to 07:00 in the company time zone (`company_jobber_settings.timezone`, default America/Chicago). Only automatic crew hire texts are held (decision D17), and the reconcile sends them after 07:00. Office texts are never held, so they can arrive at night (an accepted risk).
- **Once.** Entries marked with a key go through `alertOnce` (the `tc_alert_once` stamp in `bid_request_quotes.office_alerts`), so webhook replays, retries and the hourly reconcile never repeat them. Company-wide messages (M16, H1) use a date stamp in `company_jobber_state` instead.
- **The office** means the company owner plus every active team member who is not a crew account (`officeContacts`, the same list job-message-send uses), so a subcontractor whose account joined the team never gets office texts. When the crew accounts can't be read, only the owner gets them. M1 keeps its own narrower list, and M2 keeps bid-award's own list (below).

## Placeholders

| Placeholder | Meaning | Example |
|---|---|---|
| `{job}` | Job title, with the city in brackets when there is one | `Tree removal (Edmond)` |
| `{title}`, `{city}` | The job's title and city on their own | `Tree removal`, `Edmond` |
| `{service}` | The job's service, as in today's award packet | `Tree removal` |
| `{N}` | Jobber quote number | `1042` |
| `{J}` | Jobber job number | `877` |
| `{date}` | A day in the company time zone: weekday, month, day | `Tue Oct 20` |
| `{price}` | Whole dollars with commas | `$2,450` |
| `{who}` | First name of the person who picked the price, or `The owner` | `Mark` |
| `{option}` | The price option picked: Lowest, Recommended, +10%, +15%, Scout AI price, custom price | `Recommended` |
| `{client}` | The Jobber client's name as Jobber shows it | `Jane Smith` |
| `{match}` | Why that client was used, from `client_match` (next table) | `same email` |
| `{climber}` | The awarded climber's full name | `Sam Carter` |
| `{crew}` | Everyone hired, joined with "and" | `Sam Carter and Lee Ortiz` |
| `{company}` | The company name, or the owner's name when there is none | `Timber Edmond` |
| `{owner}` | The owner's first name | `Mark` |
| `{reason}` | `shortJobberError` text: plain words, 200 characters at most, ending with a full stop | |
| `{bidboard}` | `https://app.treecheck.ai/dashboard/bid-board` | |
| `{joblink}` | `https://app.treecheck.ai/dashboard/crew-bids?job=<job id>` | |

| `client_match` | `{match}` reads |
|---|---|
| `email` | same email |
| `phone_name` | same phone and last name |
| `email_phone` | same email and phone |
| `name_address` | same name and address |
| `new` | new client |
| `stored` | the client used before |
| `office` | picked by the office |

## Office messages

### M1. Price picked

- **Trigger:** the owner or a team member picks a price on a job (quote-pick-alert). With `quotes_on_award` on, the function replies at once, makes or reuses the quote under `waitUntil`, then sends the variant for the outcome. With the switch off, or `TC_JOBBER_KILL=1`, it sends today's text.
- **To:** today's list: team members with a phone, never the owner's number, never the person who picked, never crew.
- **Sent by:** PR 4. Until then, today's text.
- **Quiet hours:** not held.
- **Once:** one text per pick.

Every variant is `TreeCheck: {who} picked the {option} ({price}) for "{title}" in {city}.` (without ` in {city}` when there is no city), then the variant's sentences, then ` {bidboard}`.

| Variant | When | Sentences |
|---|---|---|
| manual (today's text) | Switch off, kill switch, or the job is `manual` | `It's ready to send.` |
| created | A draft quote was made | `Draft quote #{N} is in Jobber for {client} ({match}). Check it and send it. Nothing has gone to the customer yet.` |
| created, client unsure | Same, with `client_match_ambiguous` | Add `More than one Jobber client could match, so check the client first.` |
| linked | The office already made one quote for this client and property since the job came in | `TreeCheck linked quote #{N}, already in Jobber for {client}, instead of making another. Check its price and send it.` |
| several | The office already made more than one | `{client} already has more than one quote in Jobber since this job came in, so TreeCheck didn't make another. Use Link Jobber quote # on the job card to pick the right one.` |
| failed | Jobber refused, or the job has no street address | `TreeCheck couldn't make the Jobber quote. {reason} Build it in Jobber, or tap Try the Jobber quote again on the job card.` |
| uncertain | The quote may exist, but Jobber's answer never came | `TreeCheck may have made the Jobber quote but couldn't confirm it. Check Jobber for a draft for {client} before you build one. TreeCheck checks again by itself.` |
| busy | An award is making the quote at the same moment (not in the plan's list, suggested) | `TreeCheck is making the Jobber quote right now. Check Jobber for it in a minute before you build one.` |
| re-pick, still a draft | A later pick, and quote #N is still a draft (one Jobber read decides) | `Change the price on draft quote #{N} in Jobber to match. TreeCheck doesn't change quotes in Jobber.` |
| re-pick, already sent | A later pick, and quote #N already went out | `Quote #{N} already went out to the customer at the earlier price. Decide in Jobber whether to send an updated quote.` |

Example, created: `TreeCheck: Mark picked the Recommended ($2,450) for "Tree removal" in Edmond. Draft quote #1042 is in Jobber for Jane Smith (same email). Check it and send it. Nothing has gone to the customer yet. https://app.treecheck.ai/dashboard/bid-board`

### M2. Award packet

- **Trigger:** the office awards a crew on the Bid Board (bid-award).
- **To:** the office, by text and by email: today's list in bid-award, which is the owner plus every active team member, crew accounts included. PR 4 keeps it, so nobody who gets the packet today stops getting it. Whether crew accounts should drop off it, as they do from `officeContacts`, is for Haris to decide in PR 4, since the packet shows the price and the owner's margin.
- **Sent by:** PR 4.
- **Quiet hours:** not held.
- **Once:** one packet per award.

The text's first line, the email subject, heading and intro change whenever a quote exists or was linked. Today's wording stays only when no quote exists, with its dashes replaced. Today's job label puts a dash between service and city; the new one puts the city in brackets.

| Part | A quote exists | No quote (today's wording, dashes replaced) |
|---|---|---|
| Text, first line | `TreeCheck: crew awarded. Draft quote #{N} is in Jobber, check it and send it.` | `TreeCheck: crew awarded, needs a quote in Jobber.` |
| Email subject | `Crew awarded: {service} ({city}). Draft quote #{N} is in Jobber` | `Crew awarded: {service} ({city}), build the quote` |
| Email heading | `Crew awarded. Draft quote #{N} is in Jobber` | `Crew awarded, ready to quote` |
| Email intro | `{company} awarded this job. Draft quote #{N} is in Jobber for {client}. Check it against the details below, then send it to the homeowner. Nothing has gone to the customer yet.` | `{company} awarded this job. Everything below is what you need to create the quote in Jobber and send it to the homeowner.` |

For a quote the office made itself (linked), write `Quote #{N}` instead of `Draft quote #{N}`, since it may already have gone out. After a price pick the packet says `Draft quote #{N}` (end-to-end step E4).

The quote line, which is the email's "Quote status" row and a line of the text:

| Variant | When | Line |
|---|---|---|
| created | Made at this award | `Draft quote #{N} made in Jobber for {client} ({match}) at {price}. Nothing has gone to the customer.` |
| existing | Made earlier, at the price pick | `Draft quote #{N} was made when the price was picked. TreeCheck didn't make another.` |
| linked | Linked to the office's own quote | `Linked to quote #{N}, which was already in Jobber for {client}.` |
| switched off | Jobber connected, but `quotes_on_award` off or the kill switch set | `Jobber quotes are switched off for this account. Build the quote in Jobber.` |
| not connected (today's wording) | No Jobber connection | `Jobber not connected, build the quote manually.` |
| failed | Jobber refused, or no street address | `TreeCheck couldn't make the Jobber quote. {reason} Build it in Jobber, or tap Try the Jobber quote again on the job card.` |
| uncertain | Jobber's answer never came | `TreeCheck may have made the Jobber quote but couldn't confirm it. Check Jobber for a draft for {client} before you build one.` |
| busy | A price pick is making the quote at the same moment | `TreeCheck is making the Jobber quote right now. Check Jobber for it in a minute before you build one.` |
| waiting for the other role | A climber and ground job, ground crew not awarded yet, no price picked | `No Jobber quote yet. TreeCheck makes it when the ground crew is awarded or a price is picked.` |
| manual | The job was under way before quotes were switched on, or this re-awards a job first awarded before this release | `Build the quote in Jobber as usual. This job started before Jobber quotes were switched on.` |
| manual, several | The office already made more than one quote for this client and property | `{client} already has more than one quote in Jobber since this job came in, so TreeCheck didn't make another. Use Link Jobber quote # on the job card to pick the right one.` |
| price differs | Added after any line with a quote, when the awarded crew's price differs from the quote's | `Heads up: quote #{N} is for {quote price}, but this award prices the job at {price}. Change the quote in Jobber if it should match.` |

The crew's award texts and the climber's date request keep today's wording. They now go out before the office packet (PR 4).

### M3. Approved, automatic hire off

- **Trigger:** Jobber reports the quote approved or converted (a QUOTE_ event in `jobber-webhook/legacy.ts`, or the hourly reconcile), a crew is awarded, nobody is hired yet, and `auto_hire` is off.
- **To:** the office.
- **Sent by:** PR 3 (webhook), PR 6 (reconcile).
- **Quiet hours:** not held.
- **Once:** key `M3`.
- **Text (plan):** `Customer approved quote #{N} for {job}. Tap Tell the climber they are hired on the job.`

The plan also names the kill switch as a trigger, but with `TC_JOBBER_KILL=1` the older webhook part and the reconcile stop before reading anything, so nothing is sent then.

### M4. Approved before a crew is awarded

- **Trigger:** approval arrives (QUOTE_ event or reconcile) and no crew is awarded yet: the office picked a price, the customer approved, and the award comes later.
- **To:** the office.
- **Sent by:** PR 3 (webhook), PR 6 (reconcile).
- **Quiet hours:** not held.
- **Once:** key `M4`.
- **Text, `auto_hire` on:** `Customer approved quote #{N} for {job} before a crew was awarded. Award the crew on the job card. Once they confirm their days, TreeCheck tells them they're hired.`
- **Text, `auto_hire` off:** `Customer approved quote #{N} for {job} before a crew was awarded. Award the crew on the job card, then tap Tell the climber they are hired.`

Check "no crew awarded" before the `auto_hire` off branch, so such a job gets M4 and not M3: M3 points at a button the job card doesn't show until a crew is awarded.

### M5. Approved, climber hasn't confirmed days

- **Trigger:** the webhook, the reconcile or bid-award calls bid-hire while the awarded climber's days are still requested (`climber_dates_status='requested'` and `confirmed_dates` empty). bid-hire records the request (`hire_requested_at`) and hires when the climber confirms. When the office taps the hire button instead, it sees reply A3.
- **To:** the office.
- **Sent by:** PR 6.
- **Quiet hours:** not held.
- **Once:** key `M5`.
- **Text:** `Customer approved quote #{N} for {job}. {climber} hasn't confirmed their days yet, so TreeCheck tells them they're hired as soon as they do.`

### M6. Hire confirmation

- **Trigger:** bid-hire completes a hire.
- **To:** the office (today only the owner's phone gets it).
- **Sent by:** PR 6.
- **Quiet hours:** not held.
- **Once:** one per hire, because the hire is an atomic claim.
- **Text (today's, dash replaced):** `Quote accepted. {crew} confirmed for {title} in {city}. Scheduled for {date}.` Without a city, drop ` in {city}`. Without a date, drop the last sentence.

### M7. Booking result

- **Trigger:** `bookFor` finishes for a job: after the ground crew fills its day (job-dispatch-availability), after a hire (bid-hire's follow-ups), or in the reconcile.
- **To:** the office.
- **Sent by:** PR 6.
- **Quiet hours:** not held.
- **Once:** per outcome, keys `M7:booked` and `M7:failed`.
- **Text:** at the fill, the sentence below ends today's office text `Crew complete for {job} on {date}: climber {climber}, ground {names}.` At any other time it is sent as `TreeCheck: {job} on {date}.` followed by the sentence.

| Variant | When | Sentence |
|---|---|---|
| booked | The job was created in Jobber from the quote | `Booked in Jobber as job #{J}.` |
| adopted | The office converted the quote first, and the dates match | `Linked to Jobber job #{J}, which the office made from quote #{N}.` |
| waiting (today's wording) | The quote isn't approved yet | `It will book in Jobber automatically as soon as the homeowner approves the quote.` |
| booking off | `book_jobs` is off | `Please schedule it in Jobber (automatic booking is off).` |
| failed | Jobber refused, or Jobber isn't connected | `TreeCheck couldn't book it in Jobber. {reason} It tries again within the hour, or you can schedule it in Jobber.` |

Different dates send M9 instead, and a job TreeCheck can't book sends M8. If the day already has another Jobber visit, M18 follows the sentence.

### M8. TreeCheck can't book this job

- **Trigger:** `bookingPlan` returns `office_books`: there is no day-pick call-out and no single job date, or Step 0's T4 failed, so TreeCheck never creates Jobber jobs.
- **To:** the office.
- **Sent by:** PR 6.
- **Quiet hours:** not held.
- **Once:** key `M8`.
- **Text (plan, with the job named first):** `{job}. TreeCheck can't book this one: convert #{N} in Jobber and schedule it {when}. TreeCheck links the job by itself.` `{when}` is `on {date}` when TreeCheck knows the day, otherwise `on the day you choose`.

### M9. Visit date differs from the crew's date

- **Trigger:** a linked Jobber job has no visit on the crew's date: when TreeCheck adopts the office's job, on a JOB_ event with `book_jobs` on, or in the reconcile.
- **To:** the office.
- **Sent by:** PR 3 (webhook), PR 6 (booking and reconcile).
- **Quiet hours:** not held.
- **Once:** per crew date, key `M9:{crew date}`.
- **Text (plan):** `Jobber job #{J} has its visit on {visit date}, but the crew is set for {crew date}. Move the visit, or use Change date.` Several visits read `Tue Oct 20 and Wed Oct 21`.

### M11. Second Jobber job for one quote

- **Trigger:** `linkJob` finds another Jobber job for a job that is already linked, and the linked one still stands (not deleted, and not archived without a completed visit).
- **To:** the office.
- **Sent by:** PR 3 (webhook), PR 6 (reconcile).
- **Quiet hours:** not held.
- **Once:** per extra job, key `M11:{extra job id}`.
- **Text:** `Quote #{N} for {job} now has a second Jobber job, #{extra J}. TreeCheck stays linked to job #{J}. If #{extra J} is a mistake, delete it in Jobber.`

### M12. Quote deleted in Jobber

- **Trigger:** a QUOTE_ event or the reconcile finds that TreeCheck's quote no longer exists, and TreeCheck clears its link (`clearQuoteLink`).
- **To:** the office.
- **Sent by:** PR 3 (webhook), PR 6 (reconcile).
- **Quiet hours:** not held.
- **Once:** per quote, key `M12:{quote id}`.
- **Text:** `Quote #{N} for {job} was deleted in Jobber, so TreeCheck stopped tracking it. If you made a new quote, use Link Jobber quote # on the job card.`

### M13. Job deleted in Jobber

- **Trigger:** a JOB_ event or the reconcile finds the linked Jobber job deleted. TreeCheck sets `job_state='deleted'` and clears the link.
- **To:** the office.
- **Sent by:** PR 3 (webhook), PR 6 (reconcile).
- **Quiet hours:** not held.
- **Once:** per job, key `M13:{job id}`.
- **Text:** `Jobber job #{J} for {job} was deleted, so TreeCheck unlinked it. If the work is still on, convert quote #{N} again in Jobber and TreeCheck links the new job.`

### M14. Quote archived with no job

- **Trigger:** a QUOTE_ event or the reconcile finds the quote archived with no Jobber job linked.
- **To:** the office.
- **Sent by:** PR 3 (webhook), PR 6 (reconcile).
- **Quiet hours:** not held.
- **Once:** key `M14`.
- **Text:** `Quote #{N} for {job} was archived in Jobber with no job made. If the customer said no, set Quote declined on the job card.`

### M15. Job closed with no visit done

- **Trigger:** `completionDecision` returns `cancelled`: the linked job is closed or archived with no completed visit. Nothing else changes.
- **To:** the office.
- **Sent by:** PR 3 (webhook), PR 6 (reconcile).
- **Quiet hours:** not held.
- **Once:** key `M15`.
- **Text (plan, with the job named first):** `{job}, Jobber job #{J}. Closed with no visit done: set Job complete or No longer needed.`

### M16. Jobber disconnected

- **Trigger:** a company with any switch on has no live Jobber connection, or Jobber asks for a reconnect (`getJobberToken` returns null or throws `JobberReconnectRequired`).
- **To:** the office.
- **Sent by:** PR 6 (jobber-reconcile).
- **Quiet hours:** not held.
- **Once:** once a day per company (`company_jobber_state.disconnected_alerted_on`).
- **Text (plan, with the owner's name as a placeholder):** `Jobber is disconnected, so quotes and bookings are paused. {owner} can tap Connect Jobber at app.treecheck.ai/dashboard/integrations/jobber.`

### M17. Calendar not checked

- **Trigger:** a climber's days were saved without a Jobber check, because the calendar was unavailable or ran out of time and the pick-time check let the days through.
- **To:** the office, at the end of a text it already gets: bid-submit's new-bid text, or bid-climber-dates' `{climber} confirmed ...` text.
- **Sent by:** PR 5.
- **Quiet hours:** not held.
- **Once:** part of that text.
- **Text (plan):** `(Jobber calendar couldn't be checked; please check these days.)`

### M18. Day already busy in Jobber

- **Trigger:** at booking time the day already has another Jobber visit (booked after the climber confirmed).
- **To:** the office, at the end of the M7 text.
- **Sent by:** PR 6.
- **Quiet hours:** not held.
- **Once:** part of that text.
- **Text:** `Heads up: Jobber already has another visit on {date}.`

## Crew messages

### C1. You're hired

- **Trigger:** bid-hire completes a hire.
- **To:** everyone hired on the job (the awarded climber and the awarded ground crew), by text and push.
- **Sent by:** PR 6.
- **Quiet hours:** held from 21:00 to 07:00 when the hire is automatic (Jobber approval, the reconcile), and the reconcile sends it after 07:00. Sent at once when the office taps Tell the climber they are hired. The plan doesn't say what happens when the climber's own confirmation completes a waiting hire: decide in PR 6 (suggested: send at once, since the climber is in the app).
- **Once:** one per hire.
- **Text:** `You're hired for {title} in {city}. Scheduled for {date}. {company} will send you the address and details. Open the job: {joblink}` Without a city or a date, drop those parts.
- **Push:** title `You're hired`, body `{title} in {city}. Scheduled for {date}.`, opening `/dashboard/crew-bids?job=<job id>`.

The link opens the web build, because the store apps don't have the crew screens yet (plan section 0.12).

### C2. Day refused

A reply in the app, not a text.

- **Trigger:** a climber picks days in the bid form (bid-submit) or confirms days (bid-climber-dates), and a day isn't allowed.
- **Shown:** on the bid form and the confirm-days screen, from an HTTP 200 reply `{error, rejected}`, which both screens can show (plan section 0.13).
- **Sent by:** PR 5.
- **Quiet hours:** not a text.

| Variant | When | Text |
|---|---|---|
| booked | `free_days` on, and the day is busy in Jobber or promised to another job. Climbers only | `{date} is already booked in Jobber. Pick another day.` For several days: `{date} and {date} are already booked in Jobber. Pick other days.` |
| closed | Every company: a closed weekday | `The company is closed on {date}. Pick other days.` (today's wording, with days written like `Thu Oct 22`) |
| no day left | No day today or later | `Pick at least one day, today or later.` (today's wording) |

bid-submit drops past days without a message and keeps `wants-site-visit`. The office may override a booked day and gets warning A6 instead of a refusal. Today's `Ground crew is already hired for {date}. Ask the office to move that day.` (HTTP 409) keeps its wording; PR 5 decides whether it also becomes an HTTP 200 reply.

### C3. Ground crew no longer needed

- **Trigger:** Jobber marks the linked job complete (`completionDecision` returns `complete`) while a ground call-out is still open. The call-out is closed.
- **To:** the ground workers who offered days on that call-out.
- **Sent by:** PR 3 (webhook), PR 6 (reconcile).
- **Quiet hours:** not held (D17 holds hire texts only).
- **Once:** key `C3`.
- **Text (plan):** `{job} no longer needs ground crew.`

## Haris

### H1. Daily digest

- **Trigger:** the first reconcile run after 08:00 company time, when any count below is above zero.
- **To:** Haris only, at the number in the secret `TC_JOBBER_DIGEST_PHONE`.
- **Sent by:** PR 6.
- **Quiet hours:** sent after 08:00.
- **Once:** once a day per company (`company_jobber_state.digest_sent_on`).
- **Counts only:** never customer names, addresses, prices or quote numbers.
- **Text:** `TreeCheck Jobber, {company}, {date}. Last 24 hours: {a} quotes made, {b} quote failures, {c} jobs booked, {d} marked complete. Needs a look: {e} quotes not confirmed, {f} approvals not hired after 6 hours, {g} approved with no Jobber job after 2 days, {h} for the office to book, {i} duplicate jobs, {k} deleted in Jobber, {l} closed with no visit. Jobber is disconnected.`

Only counts above zero appear, in this order, and a group with none is left out. The last sentence appears only while Jobber is disconnected.

## Replies and labels in the app

Not texts. Ids A1 to A7.

| Id | Where | Text | PR |
|---|---|---|---|
| A1 | Award toast on the Bid Board, when a quote exists | `Draft quote #{N} is in Jobber; nothing has gone to the customer` (plan) | 7 |
| A2 | jobber-backfill's reply when `jobber_import` is off | `Importing Jobber history is switched off for this account.` (plan) | 2 |
| A3 | bid-hire's reply while the climber hasn't confirmed days | `{climber} hasn't confirmed their days yet. TreeCheck tells them they're hired as soon as they do.` (plan) | 6 |
| A4 | The quote failure reason when the job has no street | `No street address on the job: add it with Edit job details.` (plan) | 4 |
| A5 | Confirm before Try the Jobber quote again on a `manual`, `failed`, `skipped` or `deleted` job | `Only if you haven't built this quote yourself.` (plan) | 4 (reply), 7 (button) |
| A6 | The office confirms a booked day for the climber | `{date} is already booked in Jobber. Saved anyway because the office chose it.` | 5 |
| A7 | Edit job details saved on a job linked to a Jobber job | `Saved. This job is booked in Jobber too, so move the visit there.` | 7 |

Today's award toast says the customer quote is on its way even when none exists (plan section 0.10). A1 replaces it when a quote exists. The Jobber line on the job card and the Jobber page's new copy are written with PR 7 and added here then.

## Today's texts that still contain dashes

These texts in files the Jobber PRs touch contain an em dash or an en dash. Whichever PR edits the line replaces the dash with a comma or a period. `tcNotify` strips dashes only from what it sends itself.

- bid-award: the crew's award text, which starts `Good news` and a dash, and the job label with a dash between service and city (also the old Jobber quote title). For a one-word customer name it sends a lone dash as the Jobber client's last name, and so do send-to-jobber and send-closeout-to-jobber. The new client code must not (`splitName`).
- bid-hire: the crew hire text and the office confirmation (now C1 and M6).
- job-dispatch-availability: the booking texts sent on approval (now M7), and the "this job is now full" text and reply.
- bid-climber-dates: the push sent when a job is rescheduled.
- bid-submit: the "Thanks" replies and the stump text.
