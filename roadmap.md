# Roadmap

## DMA setup planning (Oct 18)
- [x] Fix legacy Marketing live-price/test-key check: deployed status returns billing unavailable (unknown subscription, no profile writes) and checkout blocks with 409; authenticated browser shows explanation instead of purchase/blank state. Four tests pass; no charges or Stripe changes. Live entitlement verification remains unavailable while shared billing uses a test key.
- [x] Add photo-order guidance and email-mode drag/drop + arrows; fix asynchronous connected-mode thumbnail mismatch; verify signed-in fictional-company reordered uploads by downloading each image and matching bytes. Four photo-order tests and 11 DMA regressions pass. Remove unrelated legacy lead-promotion tab from DMA; preserve its direct route and billing. Actual email delivery remains blocked below.
- [x] Plan non-website email delivery setup, six-question brand voice survey, unlimited posts within the existing 14-day trial, and an optional in-app First Impression Websites consultation page.
- [x] Implement company email setup, six-question brand voice survey, editable preview, actual non-website AI content generation, saved drafts and copy/edit tools; signed-in Testville trial setup → generation → edited read-back verified; 11 tests pass, preview clean.
- [ ] Finish DMA email sending, delivery status and resend — blocked on configuring a verified sender domain; email buttons remain explicitly unavailable, no email delivery claimed.
- [ ] Build the final First Impression Websites page and optional in-app promotion link — blocked on Mark's marketing copy, approved images and website-demo Calendly link.

- [x] Notify subs by SMS and push after a company review is saved; preserve double-blind privacy and sandbox isolation. Four delivery-rule tests pass; review-submit deployed. No real review or notification sent for testing.

- [x] Include existing company subs in nearby results without changing privacy; My subs uses completed hires or manually marked outside work. Verified signed-in save/read-back, removed test mark, and passed 8 tests. Reviews remain Jobs → completed job → Rate your subs.

- [x] Rename the Financial Pulse sidebar tab to Pulse, place it under Marketing above Subs, and put Subs above Leads; verified signed-in sidebar order.

- [x] Rename People to Subs and move Pay from the main menu into Settings → Admin; verified signed-in navigation and 13 audience-protection tests.

- [x] Confirm LesLee's company/team account; retain office-team Home and block subcontractor Home/navigation during loading and direct links. Verified 13 tests and signed-in owner browser with simulated subcontractor metadata; no real finance read or LesLee impersonation.

- [x] Fix the brief non-Home screen after login; verified authenticated Home arrival without mounting Available Leads and tested role-specific destinations.

- [x] Add real Financial Pulse positive/negative colors and a past-30-day payments versus costs chart; deployed pulse-get and verified desktop/phone views with synthetic data only. Real financial data was not inspected.

- [x] Create and verify an isolated, fictional Home advertisement sample with all summaries visible on a phone.
- [x] Make Home "Booked vs sold" month-to-date for both figures and count accepted jobs (`job_scheduled`) as sold; verified signed-in.

- [x] Redesign Home with a clean, confident hierarchy; preserve metrics and verify authenticated navigation and screen sizes.

- [x] Keep Jobs scrolling steady: stable activity ordering, reserved photo space, and non-competing navigation; verified signed-in browsing.

- [x] Crew install page (no store buttons) — done
- [x] Resend crew invite text to Mark's phone for testing
- [x] crew-invite: use the owner's company name in the invite SMS
- [x] Invite Daniel (dstreesokie@gmail.com) to crew network
- [x] Invite Kostner Ingraham with delete/reinstall instructions in his text
- [x] Add crew walkthrough video and clear iPhone/Android steps to every invitation

## Company Setup (self-serve for other tree companies)
- [x] Setup questions on first sign-in + "How we work" settings page (CRM question, chipper/chip truck costs)
- [x] Hide Bid Board / My Subs for companies that rarely or never use subs
- [ ] "Get sub bids" button on jobs when auto-send is off
- [ ] "Request help" for already-priced jobs (ground, stump, climber, crane)
- [x] Let the owner or Leslie add stump grinding to an existing quoted job and request stump-grinder prices
- [ ] Printable/texted quote for companies not on Jobber
- [ ] Crane operators as a sub type
- [ ] Dashboard setup checklist
- [ ] Review large tree company interview (file didn't come through, waiting for it)

## Billing & pricing
- [x] Advisor summary doc: how Scout, Bid Board, subs, dispatch, Jobber all work (for pricing)
- [x] Bid Board / My Subs require Scout subscription (14-day trial); Timber Edmond exempt
- [x] Subcontractor plan $20/mo with 14-day trial
- [x] Audit and simplify owner and subcontractor signup, 14-day trial, payment, and first-use journeys
- [x] Add a safe resettable sandbox signup account so the full signup experience can be tested repeatedly
- [x] Send Mark immediate owner-only SMS alerts for signup/payment failures and serious app errors, without duplicate alert floods
- [x] Price subcontractor membership by active tree companies within 30 miles; show the local count before signup and keep no-company markets free

## Network, ratings, Scout-first (approved plan)
- [x] Scout-first start screen + AI/manual choice + setup checklist
- [x] "Need subs?" step in Scout (roles, counts, hours, equipment, pay mode)
- [x] Two-way reviews + reporting + admin queue
- [x] Shared sub network (opt-in, Find subs near you, audience option)
- [ ] Crane operators as a full sub type (invite, profile, bids, alerts) — like stump grinders

- [x] Scout Production Engine V1 (employee production plan, costs, recommended price)
- [x] Scout Company Calibration V1 (+ source/confidence/unknown per characteristic, Confirm what Scout sees step, save AI vs confirmed)

- [ ] Mark: Marketing page asks mark@timberedmond.com to subscribe
- [ ] Kostner: bid form "Send my offer" stays disabled, equipment field locked
- [x] Message ground workers from job cards (office + worker side, both use JobChat)
- [x] Climbers confirm fresh dates after award; ground call-out waits; past dates never sent
- [x] Simplify menu: Dashboard, Jobs, Scout, Marketing, Pulse, Subs | Settings (Integrations, Profile, Admin); Leads hidden behind switch
- [x] Dashboard tab icon: house replaced with a dashboard panel-grid icon
- [x] Jobs tab icon: gavel replaced with a clipboard-list icon



## Team access & pricing restructure (Mark's spec, Oct 17)
- [ ] Complete approved test-only implementation from uploaded approval; preserve Apple purchases and legacy accounts; report verified lifecycle and exact blockers without another general approval.
- [x] Canonical price catalog + quote calculator with acceptance tests
- [x] Stripe test-mode monthly/annual prices for Core, Scout, Manager, Field, DMA
- [x] Database: company billing version, seat capacity, member seat + permissions, audit log, legacy flag; owner-company backfill checked, zero missing
- [x] Team page: presets, permission checkboxes, seat type, invoice-preview confirmation (Pulse explicitly disabled pending reviewed access contract)
- [ ] invite-team-member / manage-team-seat: server seat math, locking, idempotency, prorated invoice preview
- [ ] Enforce permissions (Scout, DMA, Pulse owner-only, Pay) in policies + functions
- [ ] Pricing/signup pages switched to new catalog for new customers
- [x] Browser-verified test signup, included Field reservation, test-card Checkout, subscription readback, Scout seat purchase and invited-member Scout access
- [x] Stripe accepted renewal seat reduction with $0 due today; 41 relevant regression tests passed
- [ ] Annual purchase, renewal clock advance, failed payments and repeated signed webhook E2E; Stripe sandbox webhook delivery must be configured/verified
- [ ] Native new-price packages and TestFlight purchase/restore/cancel: blocked on Haris's App Store Connect/RevenueCat packaging
- [ ] Team Pulse grants: blocked on reviewed extension of maintained Pulse access contract; remains owner-only
- [ ] Remaining independent app work: Field job assignments, owner add-ons after Checkout, capture-only submission, automatic invite delivery, atomic paid assignment completion

## Follow-up amendment (Oct 18)
- [x] Recommended Core + 1 Scout ($128/mo, $1,248/yr, $104/mo equivalent) presented on pricing + signup; assignability explained; Core-only $79/$780 kept; Core does not include Scout estimate creation
- [x] New trial owners land on photo-first Scout start screen; no integration required before trying Scout
- [x] Trial includes one Scout license; conversion matches selected package; no auto-upgrade
- [x] Catalog tests assert recommended totals and Core-only totals (79 tests pass)
- [ ] iOS Core+Scout packages blocked on Haris App Store Connect/RevenueCat packaging

## Dashboard summary (Oct 20)
- [x] Welcome back summary: Pulse owners get a fixed-rules Pulse month summary (no AI); others get an AI summary of jobs, quotes and Scout

## Free owner plan (Oct 20)
Plan approved. Tasks:
- [x] Database: business location + Oklahoma eligibility, company plan level, monthly usage (5 jobs, 3 Scout, 3 DMA), permission update
- [x] Business location question (Dashboard card + locked screen), admin override
- [x] Jobs/Subs open on Free; 5-job cap enforced in bid-request-create, job-dispatch-open, crew-invite; counter + limit prompt
- [x] Scout preview (blurred estimate) and DMA preview (partial post), server-redacted, unlock on trial (DMA verified end to end; Scout not run live because each capture texts the admin and calls n8n)
- [x] Oklahoma signup: Free vs 14-day trial cards; free start without card
- [x] iPhone safe mode for locked sidebar buttons
- [x] Tests + AGENTS.md rule
- [x] Answered: Free owners post jobs via Jobs → New bid request; non-Pulse dashboard shows a "Set up" Pulse card and the AI jobs summary
- [ ] Welcome page "I run a tree company" card: switch to new pricing in the same step the live checkout moves to the new catalog (waiting on Mark's go-live decision)
- [ ] Free plan: website leads that hit the 5-job limit stay in the leads list instead of waiting in Jobs (needs a 'waiting to send' job state)
