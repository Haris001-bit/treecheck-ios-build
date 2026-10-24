# Crew Bid Board — contract climbers bid on your jobs

Turn a Scout capture into a private bid request sent to your contract climbers. They see the photo and description, submit their minimum and ideal pay plus the crew, equipment and hours they need, and pick from your open Jobber dates. You compare sealed offers side by side with required sale price and profit, then award the job.

## How it works for you

1. You capture a tree in Scout as you do today (photo, notes, address, worksheet).
2. On that capture you tap **Request crew bids**, set a response deadline, and choose which climbers get it (default: everyone in your network).
3. Each climber gets a text and a push alert. They open the app, see the photo, the job description and the address city (no customer name or phone).
4. They submit: minimum pay, ideal pay, crew size, equipment needed, estimated hours, and which of your open dates they can work.
5. Bids are **sealed** — climbers only ever see their own.
6. Your Bid Board lists every offer with required sale price and your profit at your target margin, plus their rating and past jobs. You tap **Award** on the winner.
7. The winner gets a text confirming the award and the agreed date; the others get a polite pass. The awarded date and climber are attached to the capture so it flows into your bid/quote.

## Your crew network

- **Invite:** you enter name, phone and email; they get a text with a link to set a password.
- **Self-signup:** a public "join the crew network" page puts them in a Pending list; nobody receives bid requests until you approve them.
- Each climber has a profile: trade (climber / ground / both), certifications, equipment they own, phone, and a rating plus jobs-completed count you build up as you award work.
- Climbers are a separate role from your team seats — they see only the Bid Board, never leads, Scout rates, DMA or customer contact details.

## Profit math

The board shows, per bid: climber pay, your own costs, required sale price, and profit at your target margin. I'll wire in your exact formula — **paste it in your next message** and I'll implement it as written. Until it arrives I'll build the calculation as a single configurable function with your target margin (default 30%) and your existing Scout rate card as the cost inputs, so swapping in your formula is a one-line change.

## Jobber availability

The app reads your Jobber calendar and offers your next 3–4 open days as the choices in each bid. Note: your current Jobber connection can read clients, quotes and jobs but not the schedule, so you'll need to tap **Reconnect Jobber** once after this ships to grant calendar access. If Jobber can't be read for any reason, the climber gets a plain date picker instead so bidding never blocks.

## Technical notes

New tables (all with RLS + GRANTs):
- `crew_members` — owner_contractor_id, user_id, trade, certifications, equipment, phone, status (pending/active/inactive), rating_avg, jobs_completed.
- `bid_requests` — capture_id, owner_contractor_id, description, photo_path, status (open/awarded/closed/expired), deadline_at, offered_dates jsonb, awarded_bid_id.
- `bids` — request_id, crew_member_id, min_pay, ideal_pay, crew_size, equipment, est_hours, available_dates jsonb, status (submitted/won/lost/withdrawn), notes.
- Optional `crew_ratings` for post-job scoring.

RLS: owner sees all rows for their network; a climber sees `bid_requests` only via an invited-recipient join and only their own `bids` row (sealed). Photo access via short-lived signed URLs from the existing `lead-photos` bucket, same pattern as `get-signed-photo-url`.

Edge functions:
- `crew-invite` / `crew-join` / `crew-approve` — network management, reusing the existing invite + Twilio SMS pattern.
- `bid-request-create` — creates the request, pulls open dates from Jobber (`jobber_tokens`, GraphQL), fans out SMS + push via `send-push`.
- `bid-submit` — validated climber submission (Zod), one active bid per climber per request.
- `bid-award` — marks winner, closes the request, notifies everyone, writes the awarded climber and date back to the capture.

Frontend: `CrewNetwork.tsx` (owner), `BidBoard.tsx` (owner comparison table with profit columns), `CrewBids.tsx` (climber inbox + submit form), a **Request crew bids** action on the Scout capture, and sidebar entries gated by role. Jobber scope addition requires re-running OAuth; `jobber-connect` scopes get `read_scheduled_items`.

Out of scope for this first version: paying climbers through the app, contracts/e-signature, and multi-round or counter-offer bidding.
