# "Schedule a visit" text to the client

## What the owner sees
Each job card in Jobs (website leads and Scout jobs) gets a **Schedule visit** button. Tapping it opens a small box:

1. **How does the AI estimate look?** Three choices: About right / A little high / A little low. If there's no AI price (pruning, for example), this step is skipped and the "no price" wording is used.
2. **Text preview.** A pre-written text fills in from that choice. The owner can edit it before sending.
3. **Send.** The text goes to the client's mobile number on file. The card then shows "Visit text sent" with the date, and the button changes to "Resend".

## Letting LesLee know, and flagging the job
- **LesLee alert:** once the visit text is sent, LesLee and the office get a text and a phone alert: "Mark needs to see {client} in {city} in person. A scheduling link was sent." The alert opens that job.
- **"Needs site visit" label:** the job gets a bold label that's easy to spot, and it moves to the top of the Jobs list.
- **Filter:** a "Site visits" filter button in Jobs shows only these jobs.
- **Clearing the label:** it stays until someone taps "Visit done" on the job, or the job moves to Quote sent or later.

## Default wording
- **A little low:** "Hi {first name}, thanks for your inquiry. I saw the AI estimate, and it looks a little low. I'd like to swing by and take a look. It's a free estimate. Pick a time here: https://calendly.com/mark-timberedmond/30min. This number can't take replies, but you can call me at (405) 253-5232. - Mark, Owner, Timber Tree Service"
- **A little high:** "...it looks a little high. I'd like to swing by and take a look, and I may be able to get you a better price..." (rest the same)
- **About right:** "...it looks about right, but I'd like to swing by to confirm before we schedule..." (rest the same)
- **No AI price:** "...I'd like to swing by and take a look so I can give you an accurate price..." (rest the same)

## Settings
In Settings, each company has three fields: scheduling link, call-back phone and signature. Timber starts with the values above, and other companies fill in their own. The button tells the owner to set these up if they're missing.

## Safety
- Only the company owner or office staff, including LesLee, can send.
- The job must have a client mobile number. If it doesn't, the button explains that.
- Sandbox and Testville jobs never send real texts.
- The visit text can't be sent twice within 10 minutes, to stop double taps.

## Technical details
- Migration: add `visit_calendly_url`, `visit_callback_phone` and `visit_signature` to companies (seed Timber). Add `visit_text_sent_at`, `visit_text_estimate_view` (right/high/low/none), `visit_text_body`, `needs_site_visit` (boolean) and `site_visit_done_at` to `bid_requests`. Include grants and RLS as needed.
- `job-visit-text` also sets `needs_site_visit`, then texts and pushes office staff (LesLee) with a deep link to the job, using the existing office-recipient helper. A "Visit done" action clears the label.
- New `job-visit-text` edge function. It checks that the caller is the job's company owner or office, resolves the client's phone and first name from the linked lead or Scout capture, sends through the existing Twilio helper, and stores the sent text. It also writes the AI-estimate view to estimate feedback, so the calibration report can use it.
- New `VisitTextDialog.tsx`, used from `BidBoard.tsx` job cards, plus a fields section in Settings.
- Not tested with real texts until the owner sends one to their own phone on a test job.
