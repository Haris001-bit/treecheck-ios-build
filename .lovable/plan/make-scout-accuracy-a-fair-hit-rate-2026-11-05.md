# Make Scout accuracy a fair "hit rate"

## What changes for you
The Scout accuracy card on Home will show the share of jobs where Scout was **close enough**, instead of the average "% off".

A job counts as a **hit** when the sold price is:
- inside Scout's price range (for example, Scout said $2,000–$3,000 and the job sold for $2,400), or
- within 15% of the middle of Scout's range. This covers the case where Scout gave a single price or a very narrow range.

Example card: **"77% · 10 of 13 jobs within range"**. The trend line under it compares this month with last month, as it does today.

## Why this is fairer
- One wildly off job (for example, a crane job that sold for 3x the estimate) counts as one miss. It no longer drags the whole number down by 10+ points.
- It matches how you judge Scout yourself: "Was the ballpark right?"

## Past jobs included
The number is recalculated live from every qualifying job in your account's history, not only new ones. Nothing needs to be re-entered or backfilled. All your past Scout jobs are scored with the new "within range" rule the moment this goes live.

## Which jobs count (same as today)
- Scout jobs that have an official picked price and a Scout price range.
- Pruning/Trimming and Testville jobs are still left out.
- The card still says "Scout is learning" until 5 jobs qualify.

## Not changing
- Scout's learning report and its retraining math stay as they are. This only changes the number shown on Home.
- The sample dashboard numbers for demo accounts stay as they are.

## Open choice (easy to change later)
- The 15% "close enough" band. 10% would be stricter and 20% looser.

## Technical details
- Update the `home_scout_accuracy()` database function to also return a per-month `hits` count. The rule: sold amount between ai_price_min and ai_price_max, or |middle − sold| / sold ≤ 0.15. Keep the `jobs` column, keep the existing filters, and keep `avg_error` so older app builds still work.
- `ScoutAccuracyCard` in `src/pages/Home.tsx`: show hits / jobs as the percentage plus "X of Y jobs within range", using the same monthly trend logic.
- Add a small test for the hit rule: in range = hit; 14% off the middle = hit; 16% off = miss.
