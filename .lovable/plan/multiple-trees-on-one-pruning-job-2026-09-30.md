# Multiple trees on one pruning job

## What changes for you
- **Scout, Pruning/Trimming only:** instead of "up to 3 photos of the same tree", you get **Tree 1, Tree 2, "+ Add another tree"**. Each tree can have up to 3 photos and a short note, like "back corner oak, lift canopy". You can add up to 8 trees.
- **Tree Removal and Stump Grinding stay exactly as they are today:** one tree, up to 3 photos.
- **One job, one bid:** all the trees go out as a single job. Climbers see every tree's photos and notes, swipe through them, and send one offer for the whole job.
- **Pricing doesn't change:** the customer price for pruning still comes from the climber's pay plus crew and equipment, the same as other jobs.
- **Jobs screen:** you and LesLee see a strip of photos grouped by tree ("3 trees"), and you can tap any photo to zoom.
- **Adding a job by hand** from the Jobs screen gets the same "add another tree" option when the service is Pruning/Trimming.

## What stays untouched
- Your customer-facing AI estimate flow and its n8n webhook for removals.
- Crew-safe rules: no prices, address or phone shown to climbers.
- The Timber sub workflow and alerts. The job still texts climbers once, the same as today.

## Technical details
- Scout already saves several photos per capture (`scout_captures.photo_paths`), but crew jobs only carry one (`bid_requests.photo_path`). Add nullable `bid_requests.photo_paths text[]` and `bid_requests.trees jsonb` (`[{label, note, photo_indexes}]`), plus the matching `scout_captures.trees jsonb`. This is additive only, and `photo_path` stays as the cover photo.
- `InstantEstimator.tsx`: when the service is Pruning/Trimming, switch to grouped-by-tree photo entry (3 per tree, 8 trees max, so 24 photos max). Keep `MAX_PHOTOS = 3` for everything else.
- `scout-submit`: accept `trees` for pruning, and reject more than 3 photos for non-pruning captures on the server side.
- `bid-request-create`: copy `photo_paths` and `trees` from the capture, or from the manual dialog's uploads.
- `RequestCrewBidsDialog.tsx`: add multi-tree photo upload when the service is Pruning/Trimming.
- `CrewBids.tsx` and `BidBoard.tsx`: show a gallery grouped by tree, using signed URLs for each photo and the existing PhotoZoomDialog with next/previous buttons.
- Record the rule in AGENTS.md: multi-tree jobs are pruning-only.

## Not in this round
- Multiple trees on removal jobs.
