# Self-setup for any tree company ("Company Setup")

## Goal
A new tree company signs up, answers 4-5 quick questions, and lands in an app that already fits how they work. The full Timber Edmond setup (all-subcontractor, website leads, bid board, Jobber, ground and stump alerts) becomes one possible setup, not the only one. Everything they choose can be changed later on one Settings page.

## The setup questions (one per screen, tap to answer, about 60 seconds)

1. **How often do you use subcontractors?**
   Almost every job / Now and then (big or busy jobs) / Rarely / Never, I have my own crew
2. **When you do, who do you call?** (pick any)
   Climbers / Ground workers / Stump grinders / Crane operators / None
3. **Who does your own crew include?** (pick any, skipped for "almost every job")
   Climber / Ground crew / Stump grinder / Crane / Just me
4. **Where do your jobs come from?** (pick any)
   TreeCheck website / Our own website form / Phone/call system / Walking neighborhoods (Scout) / Word of mouth, entered by hand
5. **Do you use Jobber?** Yes, connect it now / Yes, later / No

Then one screen with their **default job costs**: ground crew hourly rate, disposal cost per load, climber pay share, crane hourly rate, stump grinding price, and the owner's minimum share. These are pre-filled with sensible numbers, so they can just tap Continue.

## What each answer turns on

```text
Almost every job  -> Bid Board sends every new job to subs automatically (like Timber Edmond)
Now and then      -> Bid Board is on, but nothing goes to subs until the owner taps
                     "Get sub bids" on a job. Default: "Price it myself"
Rarely / Never    -> Bid Board and My Subs are hidden. Scout + Leads only
                     (they can turn them on later)

Sub types chosen  -> only those roles show in invites, bid forms and alerts
Own crew roles    -> those roles are not sent out by default. The owner can still
                     ask for help per job ("Need 2 extra ground workers")
Lead sources      -> shows the matching connection steps (webhook link, TreeCheck
                     site, Scout). Hides the ones they don't use
Jobber = No       -> the "Award" button makes a quote they can print or text
                     instead of a Jobber quote. Jobber booking steps are skipped
```

## "I already priced it, I just need a few guys" (the owner's example)

A new **"Request help"** button on any job (Scout capture, lead, or one typed in by hand) opens a short form:
- What do you need? Climber / Ground workers (how many) / Stump grinder / Crane
- Days, hours expected, pay per person (or ask for bids)
- Equipment on site (skid steer, chipper, crane, and so on)

This skips the climber-bid and homeowner-quote steps. It goes straight to the existing first-come ground call-out (or a stump or climber call-out). The owner's own price stays untouched.

## Scout for companies that already price their own jobs

- The AI estimate and the owner's worksheet (hours, ground crew, equipment, stump, crane) show side by side, as they do now, using the company's own saved rates.
- The job's worksheet answers become the defaults for "Request help": crew size, hours and needs are filled in already.
- New setting: **"Show AI estimate to"**: Owner only / Owner and office / Everyone.

## One Settings page: "How we work"
Same questions as setup, editable anytime. It also includes the default job costs, the auto-send switch, first-pick minutes, and which menus show. Whatever they change here takes effect right away.

## Keeping it simple (so they don't quit setup)
- Every question has a "Not sure, set it up for me" choice that picks the most common answer.
- Nothing is required except question 1. They can skip the rest and finish later from a checklist on the dashboard ("3 of 6 set up").
- Menus only show what they turned on. There are no empty Bid Board or Subs pages for companies that don't use subs.

## Timber Edmond and existing users
Your account and your team's are saved as "Almost every job / Climbers, Ground workers, Stump grinders / TreeCheck website + Phone / Jobber: Yes." Nothing changes for you, LesLee or your subs. Existing Scout-only users are set to "Rarely" with Scout on.

## Build order
1. Company profile + setup questions + "How we work" settings page; save your current setup.
2. Menus and features show or hide based on the answers; auto-send vs. "Get sub bids" button.
3. "Request help" button for jobs that are already priced (ground, stump, climber, crane).
4. Quote option without Jobber (printable or texted quote).
5. Crane operators as a new sub type (invite, alerts, pay rate).
6. Dashboard setup checklist.

## Technical details
- New table `company_settings` (one row per owner, keyed by contractor id): sub_usage enum, sub_roles text[], in_house_roles text[], lead_sources text[], uses_jobber bool, auto_broadcast bool (replaces reading `profiles.crew_auto_broadcast`, kept in sync), ai_estimate_visibility, onboarding_completed_at, checklist jsonb. RLS: owner read/write; team members read via `get_parent_contractor_id`. GRANTs for authenticated + service_role.
- Default job costs keep using the existing `pricing_defaults` + `scout_rate_cards`; setup writes both.
- `useCompanySettings` hook; `DashboardLayout` nav and `ProtectedRoute` read it for feature gating. `/onboarding` route shown when `onboarding_completed_at` is null (owners only; team and subs skip it).
- `bid-request-create`: send to subs only when `auto_broadcast` or the call is an explicit "Get sub bids"; filter recipients by `sub_roles` and drop `in_house_roles`.
- "Request help" reuses `job-dispatch-open`, which is extended for roles `stump`/`climber`/`crane` and a job with no climber award (with or without a bid_request; a bid_request is created with `workflow_status='job_scheduled'` if missing).
- Crane: add `'crane'` to crew trade choices + `crane_hourly` already in rate card.
- Non-Jobber quote: printable quote page from the award data plus an SMS link.
- Backfill: Timber Edmond + Trades Marketing rows as described above; all other owners get `sub_usage='rarely'`, onboarding marked complete, so nobody is forced through setup.
