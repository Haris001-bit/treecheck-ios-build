# One "Jobs" board: Scout AI + crew bids side by side

## My take on how it should work
The AI and the climber answer different questions, so both are worth keeping:
- **Scout AI** = what the *customer* should pay (market price) + photo notes (hazards, access, size).
- **Climber offers + your formula** = what the job *costs you* and what you'd quote to protect your margin.

Putting them side by side gives you a gut check: if your formula says $1,230 and the AI says $1,800–$2,200, you're probably leaving money on the table (or the climber misjudged). If the AI is far below, the job is likely harder than the photo shows. You then pick the final quote — the same "pick a quote" tap you already use, with the AI price added as a fifth choice.

**Climber pay never goes above what they ask.** The climber names their pay; that's what they get, whichever quote you send. If you sell the job for more (AI price, +10%, +15%), all the extra goes to the company. The price card already works this way; the plan keeps it and labels it clearly ("Climber gets $980 — fixed at his ask").

On showing climbers an AI payout: **don't show it to them yet.** Keep it owner-only as a "Fair climber pay (AI guide)" line — a gut check on whether an ask is reasonable, not something that ever raises their pay. After a few weeks, if it tracks well with real offers, we can consider showing it to climbers as a suggestion.

## What changes
1. **One menu item.** "Scout Inbox" and "Bid Board" become one page called **Jobs** (Bid Board stays as the page, Scout Inbox leaves the menu; old links still work).
2. **New "Needs review" tab** at the top of Jobs, next to Active / Archived. It holds Scout captures waiting for approval, with the same buttons as today (Approve, Edit estimate, Postcard, Request crew bids). Requesting bids moves the job into Active.
3. **Scout notes kept in full on each job.** Any job from Scout shows a "Scout AI" box with the complete photo notes (not shortened), difficulty, risk, and the AI price range. Nothing from Scout is lost when it becomes a Bid Board job.
4. **Scout notes carried into Jobber.** When you award and the quote is built in Jobber, the Scout notes are added to the quote's description, so they're there when you invoice the client.
5. **Comparison strip under the four quotes:**
   ```text
   Your formula (Recommended)   $1,230
   Scout AI midpoint            $2,000   (+63%)
   Climber gets                 $980     (his ask, never more)
   Fair climber pay (AI guide)  ~$1,050  (owner-only reference)
   ```
6. **Fifth quote choice: "AI price."** Tap it to pick it, just like Lowest / Recommended / +10 / +15. Awarding sends whichever is picked to Jobber; the climber's pay stays at his ask.
7. Jobs not started from Scout simply skip the Scout panel and comparison.

## Technical details
- Bid requests already store `capture_id`; load the linked `scout_captures` row (ai_notes, ai_difficulty, ai_risk, ai_price_min/max) in BidBoard.
- Move ScoutInbox list into a `ScoutReviewList` component rendered in a BidBoard "Needs review" tab (owners only, Scout entitlement); redirect `/dashboard/scout-inbox` to `/dashboard/bid-board?tab=review`; remove menu item; keep the new-capture count as a badge on Jobs.
- Fair climber pay = forward calc at sale = AI midpoint, reading the implied climber share. Display only; never used as the payout.
- AI-price pick: compute breakdown with `crewCap` = climber's ask so the extra goes to the owner (same rule as reverse mode).
- Extend `quote_pick` to accept `key: 'ai'`; bid-award already uses the picked amount and keeps crew pay at the ask.
- bid-award: append linked capture's `ai_notes` (plus difficulty/risk) to the Jobber quote description.
- Owner/team-only display; nothing added to the climber's Jobs to Bid view.
