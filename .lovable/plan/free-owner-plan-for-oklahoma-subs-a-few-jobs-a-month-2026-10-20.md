# Free owner plan for Oklahoma: Subs + a few jobs a month

## What owners get today
There is no free plan. When a 14-day trial ends without payment, the owner loses the Subs page (ratings, "Find subs near you", inviting subs) and Jobs. They see a "The Bid Board is part of Scout" paywall, or "Company Jobs and Subs access is not active" on the new pricing.

## Who qualifies: Oklahoma business owners only
- Free is only for tree companies whose **main business location is in Oklahoma**.
- The app asks for the business city and state once, in setup (prefilled from their first service area when there is one). We look the city up on a map, so the check uses the real state, not whatever was typed. Today's service areas are free-typed ("OK", "Oklahoma", blank, etc.) and can list several states, so they aren't reliable enough alone.
- A company outside Oklahoma (Texas, Idaho, etc.) keeps today's rules: 14-day trial, then a paid plan. It never sees the Free offer.
- If a company moves its main location out of Oklahoma, it keeps Free until the end of that month, then needs Core.
- You (admin) can turn Free on or off for any company by hand, for exceptions like a border-town company.

## What Free will include
- **Subs, fully:** My subs, Find subs near you, inviting subs (text invite and the join link), ratings and reviews.
- **Jobs:** up to **5 jobs a month** sent to subs (climber bids and/or a ground crew call-out) from **Jobs → New bid request**. The job list, bids, hiring and marking jobs complete work as usual for those jobs.
- **Texts:** no limit. Subs get the same alerts they get from paid companies.
- **Scout and DMA previews** (below): they can try both but only see part of the result.
- **Not included:** full Scout estimates, full DMA posts, Pulse, extra team seats, Jobber sync. Pulse keeps today's "Set up" card on the Dashboard; setting it up needs a paid plan.

## Scout and DMA previews on Free
Both stay in the menu, unlocked, so Free owners can start using them right away.

- **Scout preview:** the owner uploads a tree photo (and address/notes, like today). Scout runs the real AI estimate and shows the screen with the estimate **mostly blurred**: they can see an estimate was made and what kind of job it is, but no price or breakdown. A button says **"Start your 14-day free trial to see this estimate."** Pruning jobs show today's "needs an on-site visit" message, since pruning never gets an AI price.
- **DMA preview:** the owner uploads job photos (in order) and a voice memo. DMA writes the real post and shows the **title and first couple of sentences**; the rest of the story and the social captions are blurred. A button says **"Start your 14-day free trial to get the full post."** Nothing is published or emailed.
- **After they start the trial,** the estimates and posts they already made unlock right away, so their work isn't lost.
- **Preview limit:** 3 Scout previews and 3 DMA previews a month on Free. Each preview runs real AI and costs credits, so this stops one account from running hundreds.
- **Blurring is real:** the full price and full post are never sent to their phone or browser until the trial starts. Blurring on screen alone could be undone by anyone who knows how.
- **iPhone:** the trial button uses the existing Apple trial and shows no Stripe price or link.

## How owners end up on Free (Oklahoma companies only)
- **New Oklahoma signups can start on Free** (no card) and start the 14-day trial later from a Scout or DMA preview, or from the upgrade link. Owners elsewhere sign up for the trial as today.
- **Trial ends without paying:** an Oklahoma owner drops to Free automatically instead of being locked out. Nothing is charged and no trial restarts. Owners elsewhere stay locked, as today.
- **Already used their trial:** because a trial never restarts, these Free owners see **"Upgrade to Core + Scout"** on the previews instead of "Start your trial".
- **Canceled paid plans:** an Oklahoma owner drops to Free at the end of the paid period, not to a locked account.
- **Paying customers, founder account and legacy prices:** unchanged.

## The monthly limit
- **What counts:** sending a job out to subs uses 1 of the 5. Adding a ground crew call-out to that same job, rescheduling it or re-opening it does not count again.
- **No refunds on delete:** deleting or canceling a job does not give the send back, so the limit can't be dodged.
- **Reset:** on the 1st of each month, Central time.
- **Counter:** the Jobs page shows "3 of 5 free jobs used this month" for Free owners.
- **At the limit:** a 6th job is stopped with "You've sent 5 jobs to subs this month. Start your 14-day free trial for unlimited jobs, or wait until the 1st." The button starts the trial. Owners who already used their trial see "Upgrade to Core" instead. On iPhone this message has no price or Stripe link (Apple rule).
- **Only jobs sent through the app count.** Outside work a sub logs, and outside jobs the owner marks, never count.
- **Automatic sends:** website leads that auto-open for bids also count. When the limit is reached they wait in Jobs for the owner instead of going out.

## Subs never pay
Everything here applies to business owners only. Subcontractor accounts never pay, never start a trial and never see a Free/trial choice, limit, preview or upgrade prompt. A sub keeps getting every alert, even from a Free owner.

## Upgrade path
Free owners see one quiet "Upgrade to Core ($79/mo)" link on Jobs and Subs (web only), using the existing checkout. Upgrading removes the limit right away. Core stays the full product, so Free never undercuts it.

## Oklahoma signup: Free vs. 14-day trial
Oklahoma owners choose between two side-by-side cards, with the trial marked **Recommended**. Owners outside Oklahoma see today's trial signup only.

```text
 14-day free trial (Recommended)         Free
 ---------------------------------       ---------------------------------
 Everything for 14 days:                 Free for as long as you want:
 - Full Scout AI estimates               - Subs: find, invite, rate
 - Full DMA posts                        - 5 jobs a month sent to subs
 - Unlimited jobs to subs                - 3 Scout previews a month
 - Pulse, team seats                       (estimate blurred)
 After 14 days, pick a plan; you         - 3 DMA previews a month
 aren't charged during the trial.          (post partly hidden)
                                         - No card needed
 [Start 14-day trial]                    [Start free]
```

- The wording under the trial card matches today's trial terms exactly (card or no card, Apple or web). Nothing new is promised.
- A short line under both: "Start free now and you can still start your 14-day trial later."
- The same comparison shows again whenever a Free owner hits a limit or opens a preview, so they always know what the trial adds.

## Decisions (confirmed by Mark)
1. 5 jobs a month, then prompt to start the Core trial.
2. Only jobs sent through the app count.
3. 3 Scout and 3 DMA previews a month.
4. Oklahoma signups get both "Start free" and "Start 14-day trial", with the trial recommended and the difference spelled out.

## Technical details
- Add a company access level "free" alongside trialing/active/complimentary. The permission check grants Free owners a new subs-network permission plus job sending, never full Scout, Pulse, DMA or team-management permissions. Legacy owners count as Free when their trial is expired and they have no active Scout entitlement.
- Free eligibility is decided server-side only: a protected company business location (city, state, coordinates) is geocoded with the same lookup `crew-market-quote` uses, and `state = 'OK'` plus an optional admin override decide eligibility. Owners can't write the eligibility flag themselves, and the check sits inside the permission function, so a typed URL or edited request can't unlock Free outside Oklahoma. The eligible states live in one list so another state can be added later without code changes elsewhere.
- Split `ScoutRequiredGate` for `/dashboard/crew-network` and `/dashboard/bid-board` so Free passes. `/dashboard/pay` stays paid.
- Add a protected usage record (owner, job, month) with one row per job, and an atomic database function that claims a send and returns remaining or refused. Call it from `bid-request-create` for Free owners, including internal/service-role calls. `job-dispatch-open` checks that the job already holds a claim instead of claiming a new one.
- `crew-invite` and crew-management access rules accept the Free subs permission.
- Previews: Scout capture and DMA submission get a "preview" path for Free owners that claims a monthly preview from the same atomic usage function, runs the existing AI generation, and saves the full result server-side. A redacted view (job type and blurred placeholders for Scout; title + first two sentences for DMA) is all the browser reads until the company is trialing or paid, enforced by the read path/RLS, not just CSS. Starting a trial uses the existing trial flows unchanged; trial-used owners get the upgrade link (web) or neutral text (iPhone). Trial eligibility is checked server-side, so a Free owner can never get a second trial.
- New Oklahoma signups: `create-trial-signup` gets a "free" start that creates the account with no card, no Stripe customer and no trial dates. The trial clock only starts when they choose it.
- Make the locked sidebar buttons respect iPhone App Store safe mode (they currently open outside marketing pages).
- Tests: the 6th send in a month is refused, the 1st of the month (Central) resets it, a ground call-out on a counted job doesn't count again, deleting a job doesn't refund it, paid/trial/founder accounts are never capped, and Free never unlocks Scout, Pulse or DMA. Also: the 4th preview in a month is refused, a Free read never returns the price or full post text, a trial unlocks earlier previews, and a trial-used owner can't start a second trial.
- Record the free-tier rule in `src/lib/pricing/AGENTS.md`; the price catalog and seat prices stay unchanged.
