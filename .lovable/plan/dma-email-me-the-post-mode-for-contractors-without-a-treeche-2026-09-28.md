# DMA "Email Me the Post" mode (for contractors without a TreeCheck website)

## What the contractor sees
1. Contractors without a connected website open Marketing → Digital Marketing Agent. Instead of only the demo page, they see **"Try it now — we'll email you the post."**
2. They add jobsite photos and a voice memo, the same way it works today.
3. Scout writes the post, using the same writing that goes to connected websites.
4. They get an email with:
   - Title, location line, and the post body split into short sections (The job, The challenge, Our approach, The result, a closing call to action), laid out so it pastes cleanly into WordPress, Wix, Squarespace or GoDaddy with headings and paragraphs kept.
   - A plain-text copy below, for site builders that strip formatting.
   - Download links for their photos. Email can't carry attachments, so the links are secure and expire after 7 days.
   - A suggested page title and short search description.
5. The same post shows in the app with **Copy post** and **Copy plain text** buttons, in case they'd rather not use the email.

## Pricing and access (from your research)
- Free: **3 posts per company, total**. They never expire, don't reset each month, and need no card.
- A post only counts once it's delivered. Rewriting it or a failed send doesn't use one up.
- After the 3rd post, the contractor can still see and copy the old posts, but starting a new one shows the website offer.
- The in-app counter shows "2 of 3 free posts left".
- The limit is kept in one setting so you can change it later.

## The website reminder (changes with each post)
- The email always leads with the post they asked for, with the subject about the post. The website message comes **after** the post, per the research's email-rules advice.
- Post 1: "Nice work — this is what DMA does. On a TreeCheck website it would have published itself."
- Post 2: "You've copied and moved photos twice now. With a TreeCheck website, the next one publishes automatically."
- Post 3 / limit reached: "Ready to stop copying and pasting?" The buttons are **Have TreeCheck contact me** and **See website plans**.
- The in-app success screen carries the stronger version of the same message.
- **Have TreeCheck contact me** texts you right away with the company name and phone number. Once they've asked for contact, the reminders stop.

## Tracking whether it works
- Record when they tap Copy post, Copy plain text, or download photos.
- Add an optional **I published it** button where they can paste the page link.
- A small admin view shows, per company: posts sent, how many were copied, how many were published, and contact requests. This covers the research's three 90-day metrics.

## Later, not in this build
- A personalized "Preview this job on my TreeCheck website" mockup. The research ranks it as the strongest upsell, but it's a bigger build.

## Setup you'll need to do once
- Emails have to come from a domain you own, for example notify@treecheck.ai. You'll get a guided screen with a few records to add to that domain's settings. Emails start sending once those records are confirmed.

## Not changing
- Timber and anyone with a connected website keep publishing to their website exactly as they do now.
- **Current subscribers never see the email option.** Anyone whose posts publish directly to their website (connected website / active DMA subscription with publishing set up) sees no "Email me the post" entry point, no free-post counter, and no website reminders — in the app or in emails. The email mode is only for contractors with no website publishing.
- The customer-facing estimate flow, Jobber, and crew bidding stay the same.

## Technical details
- New `delivery_mode = 'email'` branch in `dma-publish-project`. It reuses the existing AI content generation and skips the webhook and GitHub steps.
- Store each generated post in the published-projects table with mode `email`. This lets the in-app copy view work and allows usage caps to be counted.
- Built-in app email: `dma-post-ready` template (React Email, inline styles, semantic HTML `h2`/`p`), plus 7-day signed photo URLs and idempotency key `dma-post-{projectId}`.
- Gate on `isDMAConnected === false`. The server enforces the cap by counting delivered email-mode projects per effective contractor, with the limit stored in a single config constant.
- New `dma_email_events` table (copy, copy_plain, photo_download, published_url, contact_request) with company-scoped RLS and grants.
- The contact request goes through the existing owner-alert SMS path. A sandbox company never triggers the text.
- The email domain must be set up before sends can work.
