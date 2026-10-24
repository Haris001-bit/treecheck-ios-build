# Jobs calendar and search

## What you get
- **Calendar button** at the top of Jobs. It opens a month calendar with a dot on every day that has a scheduled or completed job. Tap a day to see that day's jobs (customer, city, job type, status). Tap a job to open it.
- **Search box** at the top of Jobs. Type a customer name, street, city or job type. It searches Active and Archived jobs together and shows matches as you type.
- **Subcontractors get the same calendar and search** on Jobs to Bid. They only see jobs they were hired for, on the days they were hired. They never see prices or jobs they weren't picked for.

## Where the dates come from
- **Scheduled:** the climber's hired day and the ground crew's day, plus the scheduled day set in Jobs.
- **Completed:** the day the job was marked Job complete.
- **About Jobber:** your Jobber calendar data is stored with the Financial Pulse bank and revenue data, and I'm not allowed to read it. Until then, the calendar shows the dates saved in the app, and those already change when you reschedule in Jobs. To show exactly what's on the Jobber calendar, Haris (your Jobber developer) only needs to copy each Jobber visit date onto the job. The calendar would then show it with no other change.

## Technical details
- New `JobsCalendar` dialog (shadcn Calendar with day modifiers) + `JobSearch` input, used by `BidBoard.tsx` and `CrewBids.tsx`.
- Owner/office: built from already-loaded `useBidRequests` rows (`awarded_date`, `awarded_ground_date`, `confirmed_dates`, `completed_at` in America/Chicago). Search is a client-side match on `customer_name`, `customer_address`, `city`, `title`, job type; ignores the Active/Archived tab while a query is typed.
- Subs: new SECURITY DEFINER SQL `crew_calendar_jobs()` returning only jobs where the caller's active `crew_members` row holds the awarded climber/ground/stump bid or a claimed dispatch slot. Returns id, title/job type, city, street address, the caller's hired dates, completed date. No prices. Executable by authenticated only.
- No Pulse/Jobber tables, files or functions touched.

## iPhone side-to-side wiggle fix
- Cause: something on some screens (wide rows of buttons, long badges or text) is slightly wider than the phone. iPhone then lets the whole page slide sideways.
- Fix: lock the app to up-and-down scrolling only, and check Home, Jobs, Pay and Jobs to Bid at phone width so nothing is wider than the screen. Wide button rows will wrap onto a new line instead.
- Technical: `overflow-x: clip` on html/body and the dashboard main area, `overscroll-behavior-x: none`, `min-w-0` on flex children, `flex-wrap` on the Jobs filter row. Verify at 390px width in Playwright, checking `scrollWidth <= clientWidth`.
