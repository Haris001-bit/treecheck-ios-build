# Daily ground-crew reminders and climber "more dates" requests

## What it does

**1. Daily ground-worker text (8:00am Chicago, once a day)**
- Covers every open ground-crew call-out that still has spots left and at least one date today or later.
- Each ground worker gets **one** text listing every job that still needs help, for example:
  "Timber Edmond still needs ground workers: Choctaw tree removal — Oct 8, 9 (3 spots). OKC pruning — Oct 5, 6, 7 (2 spots). Log in and pick your days: app.treecheck.ai/dashboard/crew-bids"
- Only past dates are left out. Jobs that are already full or closed are never listed.
- Not sent to workers who paused themselves, or to a worker who already picked days on every listed job.
- LesLee and Mark are **not** copied on this one.

**2. "We need more dates" request to the climber**
- Happens when a call-out is down to **one** remaining date and still doesn't have enough ground workers.
- The awarded climber gets a text and app notification: "We're short on ground crew for [job]. Only [date] is left. Can you add more days you're available? [link]". The link opens the same "Confirm my days" picker they already use.
- **Mark, LesLee and the rest of the office get a copy** of each one, so you know a reschedule is in progress.
- New days the climber adds go straight onto the call-out, and the next daily text includes them.
- It goes out once per job. If those added days also run down to one, it goes out again.
- The office can still pick dates for the climber themselves, the same as now.

**3. Same rule on every job**
- Today's open jobs are covered automatically. The two jobs with only one date left (Edmond, OKC removal) would trigger a climber request on the first run.
- Sandbox and Testville jobs never send real texts.

## Technical details
- New migration: `job_dispatches.last_daily_reminder_at timestamptz` and `more_dates_requested_at timestamptz`, plus `more_dates_requested_for text` (the last date at the time of the request). The request is re-armed when the remaining date changes.
- New edge function `ground-crew-daily` (service-role only): handles the per-company digest, grouping each worker's jobs into one SMS through `sendSms`; it uses `eligibleRecipients` (role ground) and drops paused workers and workers who already responded to every listed dispatch. The same run checks the climber "one date left" rule. It is idempotent per day through `last_daily_reminder_at`.
- `bid-climber-dates` already adds dates to an open dispatch, so it is reused as-is for the climber's added days; office copies go through `officePhones`.
- One pg_cron job runs daily at 13:00 UTC (8am CDT), which is 1 run/day. The climber check also runs inside `job-dispatch-availability` after each worker response, so "down to one date" can trigger the same day.
- Update AGENTS.md with the rule: ground-crew reminders and the climber more-dates request come only from `ground-crew-daily`.
