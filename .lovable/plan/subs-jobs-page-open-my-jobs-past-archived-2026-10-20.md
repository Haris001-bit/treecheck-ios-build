# Subs' Jobs page: Open, My jobs, Past, Archived

Today the subs' jobs page shows every job they were ever sent in one long list, including closed and old ones. Add tabs so they find new work fast.

## Tabs (with counts)

1. **Open** (default) — jobs they can still act on:
   - Open for bids they haven't bid on yet ("Needs your bid" at top)
   - Bids they've submitted that are still undecided ("Waiting on the office")
   - Ground crew day requests still open
   - Hidden automatically once the job is awarded to someone else, closed, or all offered dates have passed
2. **My jobs** — jobs they won or were hired for that aren't finished: upcoming dates, "Pick your days" requests, start info.
3. **Past work** — jobs they completed: date, job type, city, their pay, and their review (with the Rate button if not rated yet).
4. **Archived** — no longer available: awarded to someone else, cancelled/closed, or expired. Read-only, labeled "No longer available".

## Extras (suggested)
- Badge on the Open tab showing how many new jobs they haven't opened yet.
- Search box across all tabs (same as the office Jobs page).
- Text/review links (`?job=`, review window) open the correct tab automatically.
- Empty Open tab says "Nothing open right now — we'll text you when a job goes out."

## Not changing
- What subs can see (no prices, same privacy), notifications, bidding rules, the office's Jobs page.

## Technical details
- `src/pages/CrewBids.tsx`: classify each request + dispatch into open / mine / past / archived from existing fields (`status`, `awarded_bid_id`, my bid `status`, `workflow_status === 'job_complete'`, offered/confirmed dates vs today); render with shadcn Tabs, default Open, tab kept in `?tab=`.
- Pure classifier in a small `src/lib/crewJobTabs.ts` with tests (lost bid → archived; awarded to me + complete → past; open + no bid → open; dates all passed → archived).
- Keep reserved photo height and no animated scroll (existing Jobs rule).
- Verify signed in as a sub on phone size.
