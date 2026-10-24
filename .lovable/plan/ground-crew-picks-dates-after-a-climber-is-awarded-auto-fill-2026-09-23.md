# Ground crew picks dates after a climber is awarded, auto-fills and auto-schedules

## What changes for you
1. **"Award this crew" starts the ground-crew call-out right away.** Today the call-out waits until the homeowner accepts the quote. Now it goes out when you award the climber.
2. **Every ground worker gets a text and a push notification:** "We need 2 ground workers for Tree Removal — Edmond. Pick the days you can work." The number comes from the ground crew size the climber asked for. You can change it on the Bid Board before awarding.
3. **Ground workers pick their dates.** They open the job card in the app and see the photo, the city, the pay per worker, and **only the climber's available dates**. They tap every day that works, then tap **Save my days**. They can change their picks until the job fills.
4. **It fills itself.** The moment enough workers (for example 2) have picked the **same date**, the job closes:
   - Those workers get a text and a push: "You're hired for [job] on [date]." The street address is included now.
   - Everyone else who picked days gets the neutral message: "This job is now full. Thanks, watch for the next one."
   - You and LesLee get a text and a push: "Crew complete for [job] on [date]: climber [name], ground [names]. Scheduled in Jobber." If the Jobber step can't run, the message says "Please schedule" instead.
   - If two dates fill at the same moment, the earliest date wins.
5. **Automatic Jobber scheduling (preferred).** When the crew is complete, the app creates the job in Jobber, or reuses the one already there, and books a visit on that date with the climber's notes. If Jobber isn't connected or refuses the request, LesLee gets the "Please schedule" text. The Bid Board then shows a **Schedule in Jobber** button so she can try again.
6. **First pick still applies.** Ground workers you flagged for first pick see the call-out an hour before everyone else, as they do today.
7. **Bid Board view:** each awarded job shows a small date grid with how many workers picked each day ("Oct 3: 1 of 2, Oct 4: 2 of 2 filled"), plus the hired names.

## What I need to confirm while building
- Jobber normally makes a job only after the homeowner approves the quote. If the quote isn't approved yet when the crew fills, I'll create the job and visit directly for that client. If Jobber won't allow that, I'll hold the booking and create it automatically once the quote is approved. You and LesLee get told which one happened.

## Technical details
- Migration: add `available_dates jsonb default '[]'` and `updated_at` to `job_dispatch_responses`, with a new `response` value `'available'`, plus `awarded_date`, `hired_crew_member_ids uuid[]`, `jobber_job_id` and `jobber_visit_id` on `job_dispatches`, and the `offered_dates jsonb` field. The existing grants and RLS stay in place.
- `bid-award`: after the award, call `job-dispatch-open` with `offered_dates` set to the winning climber's `available_dates` (the site-visit placeholder is left out) and `slots` set to the climber's `ground_crew_size`. Hold the address until hire. In `bid-hire`, stop opening a second dispatch if one already exists (it already does this).
- New `job-dispatch-availability` function (replaces the claim flow for date-based dispatches): checks that the caller is an active invited recipient and that the dates are a subset of the offered dates. It saves the worker's picks, then runs a locked check (`SELECT ... FOR UPDATE` on the dispatch, run as an RPC) for any date with at least as many picks as spots. On a fill it marks the dispatch `filled`, records the date and the hired workers, and sends texts and pushes through `sendSms`/`sendPush`. It then calls the Jobber scheduler. A worker who changes picks after the fill gets "job full."
- New `jobber-schedule-visit` helper, sharing the token refresh from `bid-award`: find or create the client, create the job (or reuse `leads.jobber_job_id`), then book a visit on the date. It stores the IDs and the Jobber error text on the dispatch. It can be triggered again from a Bid Board button.
- Frontend: in `CrewBids.tsx`, the ground call-out card changes from "Claim this spot" to a multi-select date list with a Save button. `BidBoard.tsx` gets the date fill grid, the hired names, the Jobber status and a retry button. The `useJobDispatches` type is updated.
- Old single-claim dispatches still work, so nothing breaks.
- Test end to end in Testville with 2 test ground workers: award, both pick the same date, then check the auto-close, the messages and the Jobber call response.
