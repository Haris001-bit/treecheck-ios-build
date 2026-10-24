# Ground crew, capability profiles, and running availability

Two things here: the pricing prompt you asked for (paste-ready at the bottom), and the ground-crew build.

## What's already true

Signup already asks whether someone is a Climber, Ground crew, or Climber + ground — so a climber who also wants ground work is already covered by the "Climber + ground" choice. What's missing is the capability questions, a real availability calendar, and ground-only job requests.

## 1. Capability questions at signup

Signup becomes two short steps: who you are (name, mobile, email, password, what you do), then "What can you do?" — checkboxes, quick to tap, no free typing required.

Asked of everyone:
- Do you carry your own insurance? (yes / no / working on it)
- Can you run a skid steer?
- Do you have experience driving a truck and trailer?
- Are you comfortable making disposal runs (hauling debris to the dump site)?
- Do you have your own chainsaws / hand tools?

Asked only of climbers (and climber + ground):
- Are you certified for crane work?
- Do you want ground work too, on days you're not climbing?
- Years climbing

Asked only of ground crew:
- Have you worked tree jobs before? (never / some / experienced)
- Can you run a chipper?
- Do you have a valid driver's license?

A short "anything else we should know" box stays optional. None of this blocks anyone from joining — it's a capability profile, not a screen. You see it all on the person's card in Crew Network, and you can edit it yourself if they get a new certification or buy a skid steer.

## 2. Running availability

Every crew member gets an Availability screen — one menu item in their app:
- Which days of the week they normally work (Mon–Sun toggles)
- A calendar where they mark specific days off or specific days they're free
- One switch: "Available for work right now" / "Not taking work" — for when they're on vacation or already booked out

They set it once and update it when things change. Their card in Crew Network shows a plain "Available Mon–Fri, off Sep 22–26" line and a green or grey "taking work / not taking work" dot, and the Bid Board sorts unavailable people to the bottom when you pick who to send a job to. When a job's offered dates don't overlap with someone's availability, they're marked as unlikely rather than hidden — you can still send it.

Nudge: anyone who hasn't touched their availability in 14 days gets one text asking them to confirm it's still current, so the calendar doesn't go stale.

## 3. Ground crew job requests

The same bid flow, with a ground-work version:
- When you create a job you pick who it's for: climber, ground crew, or both. Both means the climber question and the ground question go out as one job with two lists of bids, so you can pick a climber and a ground guy for the same day.
- Ground crew see the photo, the type of work, the city, and the notes — no pricing, same as climbers.
- Their bid form asks for what fits ground work: minimum pay, ideal pay, whether it's a day rate or hourly, how many hours, how many people they're bringing, what they can operate on this job (skid steer / chipper / disposal runs), and the dates they can work — pre-checked from their availability so it's one tap.
- Everyone who says they'll take ground work gets notified for ground jobs, including climbers who chose "Climber + ground."
- Awarding works exactly as it does now: the person you pick gets "you're the crew we're going with," everyone else gets the thank-you, and the office packet goes to you and LesLee. When you hire both a climber and a ground crew for one job, the packet lists both and both get hired when the customer accepts the quote.

## 4. Your review board

The Bid Board grows a second section per job: Climber bids and Ground bids side by side, each with pay, hours, people, capabilities, rating, past jobs. Your sell-price and profit columns add the ground pay into the cost so the profit number reflects both hires.

## Technical notes

- `crew_members`: add `insured`, `wants_ground_work`, `can_skid_steer`, `can_chipper`, `crane_certified`, `truck_trailer_experience`, `disposal_runs_ok`, `owns_saws`, `has_drivers_license`, `tree_experience_level`, `years_climbing`. Booleans default false / null where unknown, all editable by the owner and by the crew member themselves (RLS already scopes to owner + own user_id).
- New `crew_availability` table: one row per crew member with `weekly_days jsonb`, `taking_work boolean`, `unavailable_dates jsonb`, `available_dates jsonb`, `updated_at`. Grants to authenticated + service_role, RLS: crew member manages their own row, owner reads rows for their crew via `owns_crew_member`.
- `bid_requests`: add `role_needed text` ('climber' | 'ground' | 'both'). `bids`: add `bid_role text`, `rate_type text` ('day' | 'hourly'), `people_count integer`; keep existing columns. `bid_requests.awarded_bid_id` stays the climber award; add `awarded_ground_bid_id uuid`.
- `bid-request-create`: recipient selection filters `crew_members` by role (`trade in ('ground','both')` or `wants_ground_work = true` for ground jobs) and skips anyone with `taking_work = false`; broadcast from `create-personal-lead` passes `role_needed` from the owner's preference (default 'both').
- `bid-submit`: validation branches on `bid_role`; ground bids require min pay, ideal pay, rate type, hours, people count, dates. `bid-award` / `bid-hire` accept an optional second (ground) bid id and text both hires.
- Frontend: `CrewJoin.tsx` two-step capability form, new `CrewAvailability.tsx` (route + nav item for crew), `CrewNetwork.tsx` capability chips + availability line + owner editing, `BidBoard.tsx` role picker and split bid sections, `CrewBids.tsx` ground bid form variant with dates pre-checked from availability, `useCrew.ts` types.
- The 14-day availability nudge runs as a small scheduled function reusing the existing SMS path.

## Also: the pricing prompt you asked for

Paste this into ChatGPT and send me the answer — it replaces the placeholder profit math on the Bid Board.

```text
You are a pricing consultant for a residential tree service company in Oklahoma City / Edmond, OK.
Write me a complete, unambiguous job pricing algorithm a developer can implement exactly as written.
One formula, named inputs, editable constants, and worked examples — no vague advice.

HOW MY BUSINESS WORKS
- Residential tree work only. Job types: Tree Removal, Stump Grinding, Pruning/Trimming.
- Leads come from my website and from field estimates (a rep photographs the tree on site).
- I subcontract the work. Contract climbers and ground crews bid on each job and tell me their
  minimum pay, ideal pay, crew size, total crew hours, and equipment needed.
- I quote the homeowner, collect the money, pay the crew. My money is the spread.
- I also have direct costs: dump/disposal fees, permits, equipment rental, fuel/mobilization,
  sometimes a crane sub or traffic control.

WHAT THE ALGORITHM MUST PRODUCE
1. The price to quote the homeowner (single number plus an acceptable low/high range).
2. My gross profit and gross margin percent at that price.
3. A floor price I should never go below, and the logic behind it.
4. The maximum pay I should offer the climber and the ground crew for that job.
5. A clear walk-away / re-bid rule when their minimum makes the job unprofitable.

INPUTS AVAILABLE (use these names)
job_type; climber_min_pay; climber_ideal_pay; ground_min_pay; ground_ideal_pay;
crew_size; crew_hours (whole crew, not per person); equipment_needed;
crane_required; crane_hours; crane_hourly_rate; my_direct_costs; target_margin_pct (default 30);
city and travel miles; urgency (Emergency | ASAP | Within a month | Flexible);
and when known: DBH inches, height, proximity to structures/power lines,
access (open yard / tight backyard / crane-only), stump diameter, number of debris loads.

WHAT TO GIVE BACK
1. The core formula as plain arithmetic in calculation order, showing how crew pay, my direct
   costs, overhead, and target margin combine. State whether margin is on price or markup on cost.
2. A constants table with recommended starting values for a small OKC-area tree service:
   overhead recovery per job or per crew hour, minimum job price by job type, disposal per load,
   mobilization per mile or per trip, crane handling, emergency/after-hours uplift, difficulty
   uplifts (tight access, near structures, over power lines), flexible-scheduling discount.
3. Rounding rules and how to present the quote range.
4. Guardrails: how to tell when the price is out of line for this market, and what to do.
5. Three worked examples, every number shown:
   a. 24" DBH oak removal, open backyard, climber ideal $1,200, 2-person crew, 6 hours,
      chipper only, direct costs $250, 30% target margin.
   b. Crane removal over a house, climber ideal $2,800, 4-person crew, 10 hours,
      crane 3 hours at $325/hr, direct costs $600, emergency same-week.
   c. Stump grinding only, 30" stump, ideal $250, 1 person, 2 hours, direct costs $40, flexible.
6. Which parts are judgment calls to tune after 10-20 jobs, and the one number I should track
   to know whether my pricing is too high or too low.

Format: (1) formula, (2) constants table, (3) guardrails, (4) worked examples.
```
