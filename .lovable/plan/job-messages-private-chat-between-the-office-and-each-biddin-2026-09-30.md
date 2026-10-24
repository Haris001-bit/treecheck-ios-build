# Job Messages: private chat between the office and each bidding subcontractor

## What you get
- On every job card (Jobs screen), a **Messages** section lists each subcontractor who sent an offer, with an unread count. Tap one to open a private conversation with that sub.
- In the sub's bid view (Crew Bids), each job they bid on gets a **Messages** button with a red dot when there's something new.
- When LesLee (or Mark) sends a message, the sub gets a text: "TreeCheck: You have a new message from Timber about 'Yukon removal'. Open: app.treecheck.ai/..." plus a phone notification. The link opens straight to that conversation.
- When a sub replies, Mark, LesLee and office team members get the same kind of text and see an unread badge on the job.

## Decisions made up front (to avoid back-and-forth)
1. **Private, one-to-one threads.** Each sub only ever sees their own conversation with the office. Sealed bids stay sealed; subs never see each other's messages or prices.
2. **Whole office sees every thread.** Mark, LesLee and team members share the same inbox for a job, so anyone can pick up a conversation. Each message shows who sent it.
3. **Who can be messaged:** subs who sent an offer on the job, plus ground workers who claimed a spot. Nobody else.
4. **Text alerts are throttled:** at most one "you have a message" text per person per conversation every 10 minutes, so a burst of 5 messages doesn't send 5 texts. In-app badges update instantly.
5. **Message text is never put in the SMS** — texts only say "you have a message," so nothing private lands on a lock screen and replies must happen in the app (sub replies by text are not captured; the text says "Reply in the app").
6. **Guardrails:** subs can't see the homeowner's phone/address through chat; the sub sees only the job name and city, same as today. Text only, 2,000 characters, no photos in V1.
7. **Closed or deleted jobs:** conversations stay readable on archived jobs; deleting a job deletes its messages.
8. **Honest status:** if a text fails (e.g. SMS suspended), the sender sees "Saved — text alert failed" instead of a false "sent."
9. **Sandbox/test accounts** never send real texts.

## Not in V1
- Photos/attachments, group messages to all bidders at once, replying by SMS, homeowner messaging, Jobber syncing.

## Technical details
- New table `job_messages` (bid_request_id, crew_member_id, sender_user_id, sender_side 'office'|'crew', body, created_at) and `job_message_reads` (user_id, bid_request_id, crew_member_id, last_read_at). GRANTs + RLS: office side via `is_bid_request_owner` (covers team via parent id); crew side via `owns_crew_member` and must have a bid or dispatch claim on that job.
- Inserts go through new edge function `job-message-send` (validates body with zod, checks the relationship, inserts, then sends SMS via `_shared/crewRecipients.sendSms` and `send-push` internally with the 10-min throttle and sandbox check). Returns `{ saved, alerted }`.
- Realtime subscription on `job_messages` for live updates and unread badges.
- UI: `JobMessagesPanel` component used in `BidBoard.tsx` (per-bidder list + thread) and `CrewBids.tsx` (single thread). Deep link `?job=<id>&chat=<crewMemberId>` reuses the existing open-job/restore logic.
- Verify: Playwright as office user and as a crew user sending both directions; confirm badges and that one sub cannot read another's thread.
