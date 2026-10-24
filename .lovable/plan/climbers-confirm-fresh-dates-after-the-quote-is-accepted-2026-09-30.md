# Climbers confirm fresh dates after the quote is accepted

## What changes for you
1. **Bids still include dates.** Climbers keep picking their available days when they bid, so you can still call a homeowner who hasn't decided yet: "If you can do Tuesday, we'll give you a discount." Those dates stay visible on the Bid Board. The only difference is that past dates are greyed out and marked "passed."
2. **"Award this crew" asks the climber to confirm dates first.** When you or LesLee award a climber, which you do after the homeowner accepts, the climber gets a text and a push: "You've got the job: [job]. Confirm the days you can do it." The ground crew call-out waits for their answer.
3. **Confirming is one tap for the climber.** The job card shows their bid dates already selected, with past dates removed. They can add or remove days, then tap **Confirm my days**. Only today and later can be picked.
4. **Then the ground call-out goes out automatically** with only those confirmed dates. It works the same as today: ground workers pick days, the job fills, and everyone is told.
5. **You're kept in the loop:**
   - The job card shows "Waiting on [climber] to confirm days."
   - When they answer, you and LesLee get a text: "Kostner confirmed Oct 3, Oct 6. Ground crew call-out sent."
   - If there's no answer in 24 hours, the climber gets one reminder and you get a heads-up.
6. **Office fallback:** a **Confirm dates for the climber** button, for when he tells you by phone. You can also use it to lock in the one date the homeowner agreed to in a discount call. It sends the call-out right away.
7. **Past dates are never sent** to ground workers, on any job, old or new.

## Existing jobs (like Scott Rogers)
When you tap Award, Kostner is asked to confirm new days. 9/28 and 9/30 are already passed, so they won't be pre-selected, and the ground crew never sees them.

## Not changing
Sealed bids, pricing, the quote packet to LesLee, messaging, the ground-worker date picking and fill, and the manual "tell the climber they're hired" button.

## Technical details
- Migration: on `bid_requests` add `climber_dates_status text` (null | 'requested' | 'confirmed'), `climber_dates_requested_at`, `climber_dates_reminded_at`, and `confirmed_dates jsonb`. The bid's own `available_dates` are kept as-is, as the early availability.
- `bid-award`: don't call `job-dispatch-open` right away. Set the status to 'requested', then text and push the climber.
- New `bid-climber-dates` function: accepts `{ bid_request_id, dates[] }` from the awarded climber or the office. It keeps only today-or-later dates (company local time), requires at least one, saves `confirmed_dates`, calls `job-dispatch-open` with them, and texts the office.
- `job-dispatch-open`: always drops past `offered_dates`, and refuses if none are left.
- Reminder: an hourly check (24 runs a day, very light) for requests older than 24h that haven't been reminded yet. One reminder only.
- Frontend: `CrewBids.tsx` keeps the bid date picker and adds an awarded-climber "Confirm my days" card. `BidBoard.tsx` marks passed dates, shows the waiting state, adds the office confirm dialog, and drops the date prompt from Award. `useCrew` types are updated.
- Verify in Testville: award, the climber confirms, and the call-out has only future dates. Also check the office fallback and an old bid with only past dates.
