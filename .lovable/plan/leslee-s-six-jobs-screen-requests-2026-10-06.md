# LesLee's six Jobs-screen requests

## 1. "Sent discount quote"
- The red "Send discount quote" badge becomes a small dropdown with one choice: **Mark discount quote sent**.
- After she taps it, the badge turns grey and reads "Discount quote sent · {date}". The 12-hour office reminder stops for that job.
- If the job is marked "Quote sent" again later, the timer starts over as it does now.

## 2. Passed-over climbers fold away
- Once a climber is picked, the other climber offers on that job fold into one line: "3 other offers (not picked)". Tap it to see them.
- Nothing gets deleted, so the office can still switch climbers if the picked one drops out.
- Ground crew and stump offers work the same way after someone is picked.

## 3. Activity flag on each job
- When something happens on a job, its card gets a bold flag with a short note, such as "Kostner confirmed dates", "Ground crew claimed a spot", "New offer" or "Climber changed days".
- The newest flagged jobs move up in the list. The flag clears once that person opens the job.
- Each person (Mark, LesLee) has their own "seen" state, so LesLee opening a job doesn't clear it for Mark.

## 4. Stump grinding shown on the card
- Jobs that include stump grinding show "Tree Removal + Stump Grinding" on the card and on the climber's and ground crew's job view.

## 5. "New message" opens the conversation
- Tapping the "New message" flag opens that job with the right chat already open. If a job has more than one unread chat, it opens the one with the newest unread message.

## 6. Closed days
- A new **Days we're closed** setting in Settings, with a checkbox for each weekday. It starts with Thursday and Friday ticked for Timber.
- Climbers can't pick closed days. Those days show greyed out with "Closed" in the day picker.
- Closed days are also left out of ground crew call-outs, the "Change date" picker and the daily reminders.
- Days that are already confirmed on a closed day stay as they are, but get a warning so the office can move them.

## Checking before I finish
- Test each change on the Jobs screen as the office, and the day picker as a test climber. I'll use test jobs only, so no real texts go out.

## Technical details
- Migration: `bid_requests.discount_quote_sent_at timestamptz`; `company_settings.closed_weekdays smallint[] default '{}'` (0=Sun), with Timber seeded to `{4,5}` through a data update; new table `job_activity (id, bid_request_id, owner_contractor_id, kind, summary, actor_name, created_at)` and `job_activity_reads (user_id, bid_request_id, seen_at)`. Each table gets GRANTs and RLS scoped to owner/office through `get_parent_contractor_id`. Inserts into `job_activity` happen only from edge functions using service role.
- Activity is written from `bid-climber-dates` (confirm/change), `job-dispatch-respond` (claim), `bid-submit` (new offer) and `job-message-send` (message). Unread state = latest activity `created_at` > the reader's `seen_at`. BidBoard marks a job seen when its card opens.
- `quote-followup` skips jobs where `discount_quote_sent_at` is set. BidBoard shows a DropdownMenu on the badge.
- BidBoard role groups split into the awarded bid plus a nested `<details>` for the bids that weren't picked.
- A job-type label helper adds "+ Stump Grinding" when `needs_stump_grinding`. It's used in BidBoard and CrewBids.
- The message flag sets the `?job=<id>&chat=<crew_member_id>` param, and BidBoard auto-opens JobChat for that thread.
- `ConfirmClimberDates`, DispatchActions' reschedule and `ground-crew-daily` read `closed_weekdays`. `bid-climber-dates` and `job-dispatch-open`/`job-dispatch-reschedule` reject or filter out closed days on the server.
