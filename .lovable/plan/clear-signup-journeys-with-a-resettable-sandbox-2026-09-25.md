# Clear signup journeys with a resettable sandbox

Create two clear public signup paths, one for tree company owners and one for subcontractors, with honest pricing before account creation, consistent 14-day trials, and a private simulation Mark can reset and repeat without charges or alerts.

## Public entry and audience choice

- Replace the current lead-only public page with a clear choice: **I run a tree company** or **I work as a subcontractor**.
- Keep sign-in prominent for existing users.
- Explain each audience's outcome before asking for details; preserve the iPhone-safe experience with no outside payment links or pricing where Apple rules require it.
- Keep lead intake, Scout submissions, alerts, the owner dashboard, and the existing subcontractor interface unchanged after signup.

## Tree company owner journey

- Use one owner offer everywhere: **Scout is $50/month for the owner plus $35/month per additional office team member**, with a card-required 14-day free trial.
- Explain the actual included experience: capture a tree photo and observations, use AI or manual pricing, collect private subcontractor bids, compare prices, choose the customer quote, and move approved work into Jobber.
- State clearly what is not included instead of mixing Scout, the lead marketplace, and unrelated marketing plans.
- Use one account form, then secure hosted checkout, then a reliable confirmation screen.
- After payment, send the owner directly through company setup and then into **Start with Scout** so the first useful action is obvious.
- Show trial status, days remaining, renewal price, and a **Manage billing** action in the signed-in account. Cancellation and card updates use Stripe's secure billing page.
- Add retry/polling to the confirmation screen so a short billing delay does not strand someone who already entered a card.

## Subcontractor journey

- Add a public signup path for subcontractors joining the shared local network; a company-specific invite remains available but is no longer the only understandable entry point.
- Ask for their location first and show how many participating tree companies are within 30 miles before account creation.
- Replace the flat fee with market-based membership pricing: **0 nearby companies: free; 1: $10/month; 2–5: $25/month; 6 or more: $35/month**.
- Recalculate the local tier before each renewal. If it changes, keep the current price through the current billing period and notify the subcontractor before the next renewal; apply the new price only at that renewal.
- Let subcontractors in a no-company market join free, create a profile, set availability, and be discoverable when a company enters their area.
- Disclose the exact local company count, monthly price, 14-day trial where a paid tier applies, and renewal terms before the person enters profile details or installs the app.
- Explain exactly what they receive: relevant local job alerts, Scout observations and city without customer contact details or customer pricing, private minimum/ideal pay requests, availability, and company invitations.
- Use one consistent trade list everywhere: climber, ground worker, stump grinder, crane operator, or climber and ground worker.
- For company-specific joins, show **waiting for company approval** before any membership payment request. Only approved subcontractors are asked to start the trial.
- Tell owners during invitation that the subcontractor's membership price depends on the number of participating companies within 30 miles.
- Add a reliable post-checkout activation screen so a billing delay cannot send a paying subcontractor back to the paywall.
- Preserve the current subcontractor work screens and protect all owner quote/customer pricing as they are today.

## Resettable signup sandbox

- Add an **admin-only Signup Sandbox** entry in Settings.
- Let Mark choose **Tree company owner** or **Subcontractor**, then launch the same public signup screens with clearly marked test data and a preformatted unique test email.
- Simulate checkout and trial activation locally/backend-side: no Stripe charge, no SMS, no push notification, no real company invitation, and no production job dispatch.
- Show each important state on demand: new signup, payment confirmation, company setup, pending subcontractor approval, active trial, cancelled/lapsed, and reactivation.
- Add **End test and reset**. It signs out of the sandbox identity, deletes only the sandbox-created profile and related test records, clears the simulated entitlement, and returns Mark to the beginning ready for another run.
- Sandbox accounts and rows carry an explicit test marker and cannot appear in real networks, analytics, alerts, lead matching, or billing operations.

## Billing and access consistency

- Make product entitlements the single source for Scout and subcontractor membership access; stop conflicting screens from interpreting the same account differently.
- Keep current Stripe products, webhooks, grandfathered access, founder exemption, and same-tab redirects intact while reconciling wording and status reads.
- Keep the separate lead marketplace pricing visible only where leads are relevant; do not present it as the Scout subscription.
- Respect iPhone purchase restrictions for both owner and subcontractor paywalls.

## Immediate error alerts to Mark

- Send Mark an owner-only text when a real user encounters a signup failure, checkout creation failure, payment confirmation failure, or another serious error after signup.
- Include enough context to act quickly: time, owner or subcontractor journey, screen/action, safe error summary, affected account email when known, and a short incident reference.
- Never include passwords, card details, authentication tokens, full customer contact details, or subcontractor bid/customer quote amounts.
- Capture server failures directly. Add a small global app error reporter for uncaught failures and rejected actions, while excluding expected validation messages, user-cancelled checkout, offline/network flaps, and sandbox activity.
- Deduplicate matching incidents within a cooldown window and rate-limit alerts so one broken screen cannot flood Mark's phone. Keep a database record even when the text is suppressed.
- Reuse the existing admin text destination and text delivery setup; failed alert delivery is logged without causing another alert loop.

## Verification

- Walk both public journeys on desktop and phone widths, including cancelled checkout and delayed confirmation.
- Run the complete sandbox cycle twice for each audience and confirm the second run starts clean.
- Confirm sandbox activity sends no texts, push notifications, jobs, invitations, or Stripe requests.
- Trigger one safe test incident and confirm Mark receives exactly one text; repeat it during the cooldown and confirm no duplicate text is sent.
- Confirm an unapproved subcontractor sees pending approval, not a paywall.
- Verify boundary locations and every company-count tier, including a free market and a count changing after signup.
- Confirm subcontractors never see customer addresses, phone numbers, Scout/customer estimate amounts, owner quote choices, or company margins.
- Confirm a Testville website/webhook lead and a Scout capture still create jobs through their existing paths.

## Technical details

- Add dedicated sandbox records and server-side admin checks; never rely on a browser flag for sandbox privileges.
- Use server-side cleanup for the sandbox identity and all dependent sandbox rows; production records are excluded by the explicit test marker.
- Reuse the existing hosted checkout and entitlement patterns for real users, and add a Stripe customer-portal function for web billing management.
- Centralize plan names, prices, trial wording, trade options, and platform purchase eligibility so signup pages and paywalls cannot drift again.
- Count only active, participating tree-company accounts within 30 miles; never count sandbox, disabled, duplicate, or lead-only accounts.
