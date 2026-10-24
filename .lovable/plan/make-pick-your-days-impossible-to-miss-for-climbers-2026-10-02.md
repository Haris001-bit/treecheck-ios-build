# Make "pick your days" impossible to miss for climbers

## What happened with Kostner
Yesterday afternoon Kostner got "please pick your days" requests on 6 jobs. All 6 were confirmed within about 30 minutes, so nothing is waiting on him now. But there are three real problems with how it works now, and they will happen again:

1. **The text link opens his whole job list**, not the job it's about. He has 15+ job cards, and the day picker sits below the photo, description and Scout notes on one of them.
2. **Once days are confirmed, the climber can't change them.** The card only says "You confirmed Oct 1, 9, 14". There is no button. So when he comes back to change or add days, there's nothing to tap.
3. **Old days still show** in the confirmed list (for example Oct 1 on the Goldsby job).

## The fix

**1. The link opens the right job**
- Every climber text and app alert about dates (asking for new dates, the 24-hour reminder, "add more days", the first request after award) opens that exact job. The page scrolls to it and highlights it.
- Ground-worker call-out texts open their job the same way.

**2. A "Needs your action" box at the top of the climber's screen**
- Lists every job waiting for his days, with a "Pick days" button for each one. It shows above all the job cards, so he sees it as soon as the screen opens.

**3. Day picker moves to the top of the job card**
- When a job needs his days, the picker shows first, above the photo.

**4. "Change my days" always available on jobs he's won**
- The confirmed box gets a "Change my days" button. It opens the picker with his current days already ticked. He can add or remove days.
- If ground workers are already hired for a day, he can't remove that day himself. It shows locked with "Ask the office to move this day". LesLee's "Change date" button handles that, because the hired workers have to be told.
- New days get added to the open ground crew call-out. The office gets a text with the new days.

**5. Only future days shown**
- Past days drop off the confirmed list and the picker everywhere.

## Checking before I finish
- Sign in as a test climber and open each type of link. Confirm it lands on the right job with the picker showing.
- Confirm days, change days, and try to remove a hired day (should be blocked). I'll use a test job only, with no real texts sent.

## Technical details
- Link format: `/dashboard/crew-bids?job=<bid_request_id>` (and `?dispatch=<id>` for ground workers). It is used in `bid-climber-dates` (reminder and request-new-dates texts), `ground-crew-daily` (climberCheck), `bid-award` and `job-dispatch-open`/`job-dispatch-reschedule`. Push alerts include the same route.
- `CrewBids.tsx`: reads the query param, scrolls with `scrollIntoView` and adds a ring highlight. It adds the action box (won + `climber_dates_status='requested'`), moves the picker block above the photo, and adds an edit mode for `confirmed`. Lists are filtered with `!isPassed`.
- `ConfirmClimberDates`: new `locked` prop (dates with hired workers) shown as disabled and always included.
- `bid-climber-dates`: when the ground dispatch is `filled`, it rejects removal of the hired `awarded_date`. It also merges into `offered_dates` while the dispatch is open, as it does now.
