# Explainer video pop-up for Jobs

The thing you're describing is a **pop-up window** (a "modal" or "lightbox"): the video opens on top of the page with the background dimmed, and closes with an X, the Esc key, or a tap outside.

## Where it goes
A small text link with a play icon right under the "Jobs" title and its one-line description at the top of the Jobs page:

`▶ Watch the 2-minute explainer`

- Takes no extra space (it sits inside the existing header line, next to the description).
- Always in the same spot, so it's easy to find again, but it's never a big banner and never pops up on its own.
- Opening it plays the video with sound and controls; closing it stops playback.
- Works on phones (fills the screen width) and computers (centered, about 800px wide).

## Reused for Scout and Digital Marketing Agent
The same link-and-pop-up is built as one reusable piece, so when you send the Scout and Digital Marketing Agent videos, each gets the identical link at the top of its page with no new design work.

## Video file
The only video I can find from you is "TreeCheckGrounds.mp4" (2 minutes, uploaded in September), which looks like an older grounds video, not the new Jobs explainer. Please re-attach the Jobs video when you approve, or tell me that file is the right one.

## Technical details
- Upload the video to the CDN with lovable-assets; store the `.asset.json` pointer in `src/assets/videos/`.
- New `src/components/ExplainerVideo.tsx`: link button + shadcn `Dialog` containing a `<video controls autoPlay playsInline>`; video unmounts on close so it stops.
- Insert under the subtitle in `src/pages/BidBoard.tsx` (owner Jobs page). Uses theme tokens only.
- Works in the phone apps too (no purchase or outside links involved).
