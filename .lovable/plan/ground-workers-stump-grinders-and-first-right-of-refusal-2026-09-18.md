# Ground workers, stump grinders, and first right of refusal

Climbers and stump grinders quote at inquiry time. Ground workers are only called in once the homeowner accepts your quote.

## Stump grinders — alerted as soon as the inquiry comes in

When a job comes in (website lead, automation, or Scout) and it calls for stump grinding, your stump grinders get a push notification and text right away, at the same time as the climbers: photo, work type, city, notes, and the stump diameter when we have it. Each grinder sends back the price he wants for the stump.

Their price feeds straight into the homeowner quote — the winning grinder's amount becomes the stump cost in the pricing math, so the number you quote the homeowner already covers it. Lowest price wins automatically; he's told he's on the job, the others just see it's no longer open. You can override and pick a different grinder on the Bid Board.

If no grinding is requested on that job, no grinder is ever alerted.

## How the app knows a job needs stump grinding

- **Scout captures** already record whether grinding is part of the job and the stump diameter — those carry through.
- **Website / automation leads** get two new optional fields in the webhook (needs stump grinding, stump diameter in inches). Until your automation sends them, the job shows a "Needs stump grinding?" toggle and diameter box you or LesLee can fill in on the job in seconds.
- Any job whose work type is Stump Grinding counts as needing grinding automatically.
- 12" and up is the grinders' work; under 12" the job just shows "Stump under 12in — you've got this one" and nobody is alerted.

## Ground workers — the moment you win the job

As soon as a job is marked hired, every active ground worker gets a push notification and text with the tree photo, the address, and the scheduled date. First come, first served: the number of spots equals the ground crew size the winning climber asked for. Each worker sees the pay you're offering per worker and taps **Claim this spot** or passes. When the spots fill, the call-out closes itself and late tapers see "All spots filled."

You enter one number per won job — pay per ground worker (day rate or hourly) — shown in the alert so nobody claims blind. It defaults to your usual rate, set once on My Subs.

LesLee and you get a text plus an email packet every time a spot is claimed and when a stump price is accepted, so she can get people scheduled.

## What each person sees

- **Ground worker:** one screen, "Jobs open now" — photo (tap to zoom), address, scheduled date, pay per worker, spots left, and a Claim button. Once claimed it becomes a job card with the address and date. No pricing, no customer contact beyond the address, no other subs' info.
- **Stump grinder:** the job card with photo, city, notes and stump diameter, plus a box for his price and notes. Afterwards he sees "You got it" or "No longer open."
- **You and LesLee:** each job on the Bid Board grows two sections — Stump grinding (every price in, who won, diameter) and Ground crew (who claimed, spots filled, pay) — next to the climber offers, with the accepted stump price shown inside the quote breakdown.

## First right of refusal

Any sub of any type — climber, ground worker or stump grinder — can be flagged **first refusal** on My Subs. Flagged subs get a job one hour before anyone else:

- Only the flagged subs are notified at first; their card shows "You have first pick — open until 8:05."
- If none of them responds within the hour, the job releases automatically to everyone else with the normal text and push.
- If a flagged sub does respond in that hour, nothing goes out to anyone else — it waits on you. Accept his bid or claim and the rest never see the job. Decline it and the job releases to everyone else right then.
- The head start is 1 hour by default and you can change it per account.

## Brad Smith

Brad is added as a stump grinder (405-255-4961, brad__52@hotmail.com) and gets an invite text with his login and install link, same as your climbers.

## Technical notes

- `crew_members.trade` gains `stump`; My Subs gets Stump grinder in the trade picker and groups them separately.
- `bid_requests` gains `needs_stump_grinding`, `stump_diameter_inches`, `ground_pay_per_worker`, `first_refusal_until`, `first_refusal_released_at`; `pricing_defaults` gains a default ground pay rate and `profiles.first_refusal_minutes` (default 60).
- Stump bids reuse the existing `bids` table with `bid_role = 'stump'` so they flow through `bid-submit` and the Bid Board; `bid-request-create` includes stump-trade recipients whenever the job needs grinding (diameter >= 12 or unknown), and skips them otherwise.
- Accepted stump price feeds `pricing_inputs.stumpCost` (persisted on award) so `calculatePricing` / `BidPriceCard` and the Jobber quote in `bid-award` include it; lowest quote is auto-accepted by `bid-submit` unless the owner has already picked one.
- New table `job_dispatches` (one row per won job: role `ground`, slots, pay_per_worker, status, hold window) and `job_dispatch_responses` (crew_member_id, `claimed`, status `pending` | `confirmed` | `closed`), RLS: owner and team manage their own; crew sees only dispatches they were notified on and only their own response.
- `bid-hire` fans out to a new `job-dispatch-open` (ground slots from the awarded climber bid's `ground_crew_size`) sending SMS + `send-push` to active ground-capable subs, skipping anyone paused, and texting/emailing owner + team. New `job-dispatch-respond` handles atomic claims (rejects when full) and notifies the office.
- `create-lead` / `create-personal-lead` accept optional `needs_stump_grinding` and `stump_diameter_inches`; `scout-submit` maps `wk_stump` / `wk_stump_diameter_inches`.
- First refusal: `crew_members.first_refusal` boolean (My Subs toggle + Edit skills). `bid-request-create` and `job-dispatch-open` notify only flagged, role-matching, active subs and stamp the hold window. A `pg_cron` sweep every 5 minutes calls a new `crew-release-holds` function that releases to the remaining subs when the hold expires **and** no flagged sub has responded; a flagged response freezes the release until the owner accepts (stays frozen) or declines (releases immediately, with a Release now button on the Bid Board).
- Crew views: `CrewBids.tsx` gains the stump quote form and a "Jobs open now" ground dispatch section (reusing `PhotoZoomDialog`); `BidBoard.tsx` gains the stump and ground sections, the stump toggle/diameter and ground pay inputs, and the first-refusal status line.
