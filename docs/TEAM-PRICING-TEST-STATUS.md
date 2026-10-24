# Company pricing test rollout — October 17, 2026
# Follow-up amendment applied — October 18, 2026

## Follow-up amendment (Oct 18)
- Pricing page and signup now lead with "Recommended: Core + 1 Scout license" — $128/month or $1,248/year paid upfront ($104/month equivalent), existing Core + Scout prices, no new charge. The Scout license is described as assignable to the owner or another estimator; Core-only stays at $79/$780; the page states Core alone does not include creating Scout estimates and reviewing/approving never requires one.
- New company owners now land on the photo-first Scout start screen (`/dashboard/start`) after trial signup, not the Home dashboard. Scout trial access needs no website, webhook, CRM or bank connection (server rule: `company_has_permission` returns true for `createScout` while billing status is `trialing`); integrations appear afterward as optional checklist items.
- Trial already includes one Scout license; conversion matches the package the owner selects at checkout. No auto-upgrade path exists.
- Tests: catalog suite now asserts Core + 1 Scout = exactly Core + Scout prices, annual $1,248 / $104 monthly equivalent, and Core-only $79/$780; 79 pricing/onboarding tests pass.
- Website estimator: unchanged. It is a Scout capability (Instant Estimator), included with any Scout access; website-service customers receive DMA at no extra charge (`dma_source: 'website'`). No new fee or packaging decision was made.
- iOS blocker for Haris unchanged: the native app still uses the legacy `treecheck_demo_monthly` product; Core/Scout/Manager/Field/DMA App Store packages are not configured, so Core + Scout cannot be offered on iOS yet.


## Implemented and connected
- Ten real Stripe sandbox prices, canonical USD catalog, test signup, Team seats and permissions, Checkout and invoice confirmation.
- Separate legacy billing rows; no existing owner-company rows missing from the backfill. Company owners only are backfilled, not all profiles.
- Two included Field reservations, paid vacant capacity reuse, one seat per teammate, capture-only validation and free subcontractors.
- Owner-only mutations, expiring previews, per-company locks and Stripe idempotency. Card-only USD Checkout. No live-key purchase path for this catalog.
- Subscription reconciliation on signed webhooks and owner status reads, scheduled seat reductions and interval changes, cancellation at paid-period end.
- Additional restrictive policies and company-function permission checks for Scout, Jobs, Subs, Pay, settings and DMA publishing. Legacy policies continue to apply.

## Actually tested
- Browser signup and company setup, original trial end, included Field invitation reservation, Stripe test-card Checkout, subscription readback in Team.
- Scout capacity addition, invitation acceptance and the invited user's Scout screen.
- Member removal and Stripe response accepting a vacant Scout reduction at renewal: due today zero, renewal total $79.
- Catalog/lifecycle tests cover the $276 monthly / $2,664 annual example, one-seat hierarchy, included fields, vacant capacity, capture limits and trial end reuse.
- No real customer charges, real notifications, bank/revenue reads or Apple purchases were used for these checks.

## Not complete / not verified
- Annual Checkout completion, actual renewal after clock advance, declined-card upgrade, repeated signed webhooks and all cross-role data-access scenarios still need end-to-end verification.
- Pulse remains owner-only; its disabled permission checkbox is not a working financial-access grant. Owner-authorized team Pulse requires a reviewed extension to the maintained Pulse access contract.
- Assigned-job Field access needs a company employee-to-job assignment model; current Jobs permissions favor office management and existing subcontractor recipients.
- Owner Scout and DMA additions after initial Checkout, capture-only submission without publishing, automatic email/SMS delivery for versioned office invitations, and full paid-upgrade-to-assignment atomic completion remain incomplete.
- New pricing is preview/test-signup-only. Published signup and native purchases remain legacy; this is not a verified live rollout.
- A trial with less than 48 hours remaining is prevented from paying early; last-day payment-method conversion is not implemented.

## Haris configuration and handoff
1. Verify Stripe sandbox webhook delivery for checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid/payment_succeeded/payment_failed to the deployed stripe-webhook endpoint. Status polling recovered the test purchase; webhook delivery itself was not proven.
2. Complete Apple packaging independently: Core, Scout, Manager, Field and DMA monthly/annual products or reviewed seat bundles in App Store Connect and RevenueCat. Existing treecheck_demo_monthly, treecheck_dma_monthly, treecheck_marketing_monthly and credit/unlock products must retain their existing agreements.
3. Map new Apple packages to company capacity, original trial entitlement, billing interval and renewal behavior; never emulate Stripe quantity or proration rules without StoreKit support. Validate purchase/restore/cancel in TestFlight with Apple sandbox accounts.
4. Coordinate owner-authorized team Pulse access with the maintained Pulse access contract; do not modify pulse_owner_id or financial SQL grants to satisfy a scanner.
5. Finish and verify the incomplete application paths above before any production catalog switch. Provision live Stripe prices only during a separately reviewed live rollout; preserve grandfathered, founder and website bundles.