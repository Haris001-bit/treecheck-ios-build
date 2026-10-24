# Faster job-to-job browsing on the Jobs screen

## Recommendation
Keep the list, but make each job easy to recognize at a glance. Once a job is open, let you move to the next or previous job without scrolling.

## What you'll see
1. **Photo thumbnail on every job in the list:** a small square photo on the left of each row, next to the title, status and city. Multi-tree pruning jobs get a small "3 trees" tag on the thumbnail.
2. **Opening a job jumps to it:** the page scrolls so the opened job's title and photo sit at the top of the screen. You always know which job you're looking at.
3. **A bar that stays at the top while a job is open.** It shows:
   - a small photo, the job name and "Job 3 of 12"
   - a **Previous** and a **Next** button
   - a **Close** button that folds the job back into the list
4. **Swipe:** on a phone, swipe left on an open job to go to the next job, or swipe right to go back. Tapping any photo still opens the full-screen zoom as it does now.
5. **Keyboard on a computer:** the left and right arrow keys do the same thing as the buttons.

Next and Previous stay inside whichever tab you're on (Active or Archived), in the same order as the list.

## Not changing
- What's inside each job: offers, pricing, quote pick, notes, editing and delete.
- The Needs review tab.
- Climbers' screens.

## Technical details
- `BidBoard.tsx`:
  - Add a lazy thumbnail for each row using `fetchBidPhotoSet`/cache, loaded when the row scrolls into view (IntersectionObserver) so a long list doesn't fire every photo request at once.
  - Add a ref per card. On open, call `scrollIntoView({ block: 'start' })` with an offset for the sticky bar.
  - Add a sticky `top-0` nav bar rendered while `openId` is set, with the index taken from the `shown` array. Prev/Next call the existing `toggle` for the target job, which also loads its photo.
  - Swipe: add touch start/end handlers on the open card's body. A horizontal move of at least 60px, with more horizontal than vertical movement, counts as a swipe. Swipes starting on inputs, selects or the zoom dialog are ignored so typing and pinch-zoom still work.
  - Arrow keys: add a keydown listener while a job is open, ignored when focus is in a form field.
- No database or backend changes.
