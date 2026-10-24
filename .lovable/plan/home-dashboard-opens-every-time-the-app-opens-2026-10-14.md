# Home dashboard (opens every time the app opens)

A new "Home" screen for owners and office staff, shown first after login and at the top of the menu. Four cards, stacked on phone, 2x2 on desktop. Subcontractors keep their current start screen.

## 1. Financial Pulse — month to date vs last month
- Card slot with an "Open Pulse" link.
- Intended content: money in, costs and profit so far this month, compared with the same days last month.
- The numbers inside must be built by Haris, the Financial Pulse developer. Bank data rules forbid Lovable from building or reading it. I add only the empty slot and the link; Haris drops his summary in.
- Companies without Pulse see "Connect your bank and Jobber to see how this month compares to last month" with a Set up button.

## 2. New jobs
- "You have X new jobs. Tap to open them."
- A job counts as new until you open it (each person has their own count, so LesLee and Mark each see their own).
- Tapping opens Jobs filtered to "New" (only jobs you haven't opened yet), with a chip to clear the filter.
- Zero state: "You're all caught up."

## 3. Scout accuracy
- "Scout is X% accurate" — based on jobs where an AI price exists and you picked a sold price: accuracy = 100% minus the average gap between AI price and sold price.
- Small trend line: this month vs last month, plus "based on N jobs".
- Removals and stump grinding only (pruning has no AI price).
- Under 5 priced jobs: "Scout is learning — N jobs compared so far" instead of a percent, so it never shows a misleading number.

## 4. Marketing posts (DMA)
- "X posts this month" vs last month (up/down arrow), and "Y posts since you joined".
- Not using DMA yet: "Turn your finished jobs into posts on Google, Facebook and your website" with a Start button.
- Counts follow the existing DMA rules (email-post users see their own count; no website-plan reminders for site subscribers).

## Behavior
- Opening the app or logging in lands on Home; the menu gets "Home" above Jobs.
- Each card loads on its own, so a slow card never blocks the rest.

## Technical details
- New `src/pages/Home.tsx` + `src/components/home/*Card.tsx`; route `/dashboard/home`, set as post-login redirect for owner/office roles; crews keep current target.
- New jobs: add `job_views (user_id, bid_request_id, seen_at)` with RLS (user's own rows), written when a job is opened in BidBoard (alongside existing `job_activity_reads`). BidBoard reads `?filter=new` and hides jobs with a view row. Existing jobs older than today get backfilled as seen so nobody starts with 100+ "new".
- Scout accuracy: SECURITY DEFINER SQL `scout_accuracy(p_months int)` returning per-month avg absolute % error and count, joining scout capture AI price to the picked quote amount in `bid_request_quotes`, scoped to `get_parent_contractor_id(auth.uid())`. Excludes pruning and Testville.
- DMA: count `dma_published_projects` (and email-post events) by company per month.
- Pulse: no Pulse tables, functions or files touched. Home renders a `PulseSummarySlot` placeholder outside Pulse folders; Haris wires it later.
