# Finish Apple in-app purchase setup

The app code for Apple in-app purchases is already written. What's missing are the three backend pieces that make it actually work: the database tables, the live deployment of the new functions, and the two RevenueCat keys.

## Current state (verified)

- The three new functions exist in the project: `revenuecat-webhook`, `iap-unlock-lead`, `create-ios-register`.
- `purchase-lead` already accepts a credits-only / IAP wallet unlock path (no Stripe card required).
- `revenuecat-webhook` is already configured to accept calls from RevenueCat without a login token.
- The two tables the purchase flow depends on (`iap_events`, `iap_lead_unlock_credits`) **do not exist in the database yet** — the migration file was written but never applied. Any Apple purchase today would fail.
- Neither RevenueCat key is stored yet.

## What I'll do

1. **Create the two purchase tables** in the database, with access limited to backend functions only:
   - A purchase-event log used to make sure the same Apple purchase is never counted twice.
   - A "lead unlock credit" record: one row per single-lead purchase, marked used once it's applied to a lead.
2. **Deploy the three functions** so they're live and callable:
   - RevenueCat webhook — grants credits, Premium, DMA, Marketing, and trial access when Apple confirms a purchase or renewal, and revokes on expiry.
   - Lead unlock — spends an Apple single-lead purchase on a specific lead.
   - iOS register — free account creation from inside the app (no purchase surface).
3. **Redeploy `purchase-lead`** so the credits-only unlock path is live.
4. **Ask you for the two RevenueCat keys** (webhook secret and API key) through the secure secret form, once the endpoint is live so you can paste the webhook URL into RevenueCat in the same visit.

## Technical notes

- Migration: `iap_events` (unique `event_id` for idempotency) and `iap_lead_unlock_credits` (unique `transaction_id`, `consumed` flag, indexed on `contractor_id, consumed`). RLS enabled with **no** public policies; `GRANT ALL ... TO service_role` only — the existing migration file omitted GRANTs, so I'll add them.
- `revenuecat-webhook` verifies `REVENUECAT_WEBHOOK_SECRET` from the Authorization header and writes to `profiles`, `credit_transactions`, `marketing_profiles`, `dma_subscriptions`.
- Webhook URL to paste into RevenueCat: `https://<project>.supabase.co/functions/v1/revenuecat-webhook` — I'll give you the exact URL after deploy.
- `create-ios-register` best-effort upserts into a `user_roles` table that doesn't exist in this project; the call is non-fatal, but I'll drop that block rather than leave a dead write.
- No client-side changes: `src/lib/platform.ts` already gates IAP behind `VITE_IOS_USE_IAP`.

## Not included

- Creating the products/entitlements inside RevenueCat and App Store Connect — that's done in their dashboards and needs your Apple account.
- Flipping `VITE_IOS_USE_IAP` on for the iOS build.
