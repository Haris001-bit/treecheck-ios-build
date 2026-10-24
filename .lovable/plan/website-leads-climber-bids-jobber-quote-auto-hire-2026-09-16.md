# Website leads → climber bids → Jobber quote → auto-hire

Nothing changes for you or the other companies using the system today. Website leads keep arriving exactly as they do now, with the AI assessment and estimate, in your app only. This adds a second, parallel path: the same job also appears in your climbers' app as a photo-only bid request.

## 1. A website lead automatically opens for bids

When a lead comes in through your webhook, the app also creates a bid request for your crew network and texts/pushes every active climber.

What the climber sees — and only this:
- The photo
- A short description of the tree and anything else the customer wrote
- The city (no street address, no customer name, no phone, no email)
- Never the estimated value, your price, or anyone else's bid

You keep a switch on Crew Network: broadcast every new website lead automatically, or hold them and send manually from the Bid Board. Default: automatic for your account, off for everyone else, so no other company's setup changes.

**One thing your webhook needs to send:** the customer's own words. Right now the payload carries photo, city, contact, estimate and job type — there's no field for "the customer said the tree is leaning over the garage." I'll accept a new optional `customer_notes` (or `description`) field and pass it through to both your lead detail and the climber's bid card. Until your automation sends it, the climber sees the job type and city only.

## 2. The climber's bid form

Opening the notification shows the photo and: *"New potential job. Given what you see here, what's the minimum you'd be happy with, and the ideal amount you'd like to make on a job like this?"*

Required fields:
- Minimum pay
- Ideal pay
- Crew size
- Total crew hours (whole crew, not just the climber)
- Equipment needed
- Dates they can work — checkboxes drawn from your Jobber open days

They can't submit until all of those are filled in. On submit they get: *"Thanks — we'll let you know if you're hired."* They never see other bids, and never learn they weren't picked.

**Jobber dates:** the app already tries your Jobber calendar and falls back to the next few weekdays because your connection doesn't have calendar permission yet. One reconnect fixes that and the real open dates start showing.

## 3. Your and LesLee's bid review board

One screen listing every open job with all bids side by side: minimum pay, ideal pay, crew size, hours, equipment, their available dates, plus their rating and past jobs. Next to each bid: what to sell the job for and your profit at your target margin.

LesLee gets access to this board with her existing team login — she sees the bids and the customer details she needs, and can build the quote.

## 4. Award → Jobber quote

When you award a bid, the app:
1. Creates or matches the customer in Jobber and creates the quote at your calculated sale price
2. Records the winning climber and the agreed date against the job
3. Sends you and LesLee the office packet (customer, property, crew, price)
4. Tells the climber only "you're being considered / scheduled" — not hired yet

**Send me your formula** and I'll wire the sale price exactly as you write it. Until then it uses the placeholder (climber pay + your costs, marked up to a 30% margin).

## 5. Customer accepts the quote → climber is hired

Jobber sends us a quote event. When a quote tied to an awarded job is accepted, the app automatically:
- Marks the climber hired for that date
- Texts and pushes them: *"You're hired — [job], [date]."*
- Flips the job on their screen to a hired card with the date and the details they need to show up

If the quote is declined or expires, the job quietly closes and the climber sees "no longer available," same as today.

**One item to verify:** our Jobber webhook currently handles invoice and job events, not quote events. I'll subscribe to the quote-accepted topic in Jobber; if that topic isn't available on your Jobber plan, the fallback is a "Quote accepted — hire them" button you tap, which fires the same hire notification.

## Technical notes

- `create-personal-lead`: optional `customer_notes` passthrough into a new `leads.customer_notes` column; per-owner `broadcastToCrew` flag in `OWNERS`; on insert, calls `bid-request-create` with `lead_id`, photo, job type, city, notes — no pricing.
- `bid_requests` gains `lead_id`, `crew_visible_description`, `hired_at`, `jobber_quote_id`, `quote_status`. Climber RLS stays sealed via `bid_request_recipients`; the request row exposes no cost fields to crew (select-list enforced client-side plus a crew-safe view).
- `bids` gains required validation on crew_size, est_hours, equipment, available_dates (Zod in a new `bid-submit` function so the rules are server-side, not just the form).
- `bid-award` extends into the Jobber path: reuse `send-to-jobber`'s `quoteCreate` mutation with the computed sale price, store `jobber_quote_id`, and hold the climber at "awarded, pending quote."
- `jobber-webhook`: add `QUOTE_*` topic handling → on accepted, look up `bid_requests` by `jobber_quote_id`, set hired, fire SMS + `send-push`. Register the quote webhook topic on the Jobber app; manual hire button as fallback.
- `jobber-connect` needs `read_scheduled_items` (calendar) — one OAuth reconnect from you.
- Reviewer safety: crew screens carry no prices or purchase UI, so App Store safe mode is unaffected.

## Waiting on you

- Your exact sale-price / profit formula
- One Jobber reconnect for calendar access
- Adding `customer_notes` to the n8n webhook payload so climbers see the customer's own description
