# Monday pay summary

Every Monday you get a text, and the app has a screen listing every job finished since the previous Monday and what each person is owed.

## 1. Climber pay is set by the quote you pick

When you pick a quote, the app saves the climber's pay using your rule:
- **Quote built from his minimum:** pay his minimum.
- **Quote built from his ideal:** pay his ideal.
- **Custom amount above the ideal quote:** pay his ideal.
- **Custom amount below the minimum quote:** pay his minimum.
- **Custom amount in between:** pay him the same distance between his minimum and ideal as your price sits between the two quotes.

Example: the minimum quote is $1,000 and the ideal quote is $1,400. Kostner's offer is $300 minimum and $400 ideal. A custom quote of $1,200 sits halfway between the two quotes, so he's paid halfway between his amounts: **$350**.

The amount shows on the job card ("Kostner — $350"). You can override it before the week is paid. The 4 recent Kostner jobs show **"Pay amount needed"** so you can fill them in once.

## 2. Ground workers report their own hours

- The day after a job is closed (9am Chicago), each ground worker picked for it gets a text: "How many hours did you work on [job] yesterday? Tap to enter: [link]."
- The link opens a one-box screen in their app. They enter their hours, and the hours are saved to that job.
- Pay is worked out with your standing rule: at least 4 hours at $25/hour (at least $100 per job), and $25/hour beyond that. If a job has its own ground rate, that rate is used.
- Anyone who hasn't answered after 2 days gets one reminder. You or LesLee can also type their hours in yourselves.
- Until hours come in, the worker shows as **"Hours missing"** on the summary.

## 3. The Monday pay summary

- A new **Pay** screen lists every job closed from last Monday through Sunday, grouped by person: climbers with their agreed pay, ground workers with hours, pay and weekly total, and stump grinders with their stump price.
- Arrows switch between weeks, and Download gives you a spreadsheet.
- **Mark week paid** stamps each job as paid so nothing is paid twice. Jobs that are still unpaid carry over to the next week.
- Every Monday at 7am Chicago, owners and admins get a text: "Pay summaries are ready — 6 jobs, $2,340 total, 1 worker missing hours. [link]"

## What "closed in Jobber" means here

The Jobber connection code is maintained by your Jobber developer, so I won't change it. The app uses its own **Job complete** mark. That can be set by you or LesLee, or by the Jobber sync if it already updates the status when a job closes in Jobber. If it doesn't, the Jobber developer only has to set Job complete when Jobber closes a job, and everything above runs automatically from there.

## Technical details

- Migration, adding columns only:
  - `bids.agreed_pay numeric`
  - `bid_requests.completed_at`, stamped by a trigger when `workflow_status` changes to `job_complete`. Existing completed jobs are filled in from `updated_at`.
  - `bid_requests.paid_at` and `paid_by`
  - New table `job_ground_hours (bid_request_id, crew_member_id, hours, pay, entered_by, asked_at, reminded_at, timestamps)`, with grants and RLS: owner and team get full access, and a worker can only read and write their own row.
- Pure helper `climberPayFromQuote(saleMin, saleIdeal, chosen, min, ideal)` (linear interpolation, clamped) and `groundPay(hours, rate)`, both with unit tests.
- `agreed_pay` is written where the quote pick is saved (the pick_option path), not in `bid-hire`. The Jobber modules and Financial Pulse files are untouched.
- New function `ground-hours-ask`, run by a daily 9am Chicago cron. It texts each worker once per job (dedup through `asked_at`), sends one 2-day reminder, and a sandbox company sends nothing.
- New function `pay-week-summary`, run by a Monday 7am Chicago cron. It texts the owner and admin team members counts and totals only.
- New pages: `PayWeek.tsx` (office) and a crew hours entry screen, opened from the deep link.
