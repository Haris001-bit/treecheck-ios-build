# Make Scout a paid feature with a 14-day trial

Scout is currently open to everyone who signs in. This locks it behind a subscription, adds a self-serve 14-day trial (card required), and keeps today's Scout users free forever.

## Pricing

- $50/month for the account owner
- $35/month for each additional team member (quantity grows with seats)
- 14-day free trial, card required at signup, auto-converts to paid
- Everyone currently using Scout is grandfathered: free forever, never asked to pay

## What each person sees

**Grandfathered accounts (including yours and your team):** no change at all.

**A new account without Scout:** Scout and Scout Inbox stay visible in the menu, but opening either shows a short page explaining what Scout does, the price, and a "Start 14-day free trial" button. Card details are collected up front; the trial converts automatically unless they cancel.

**During the trial:** full Scout access, plus a small banner showing days left and a link to manage or cancel.

**After a cancelled or lapsed subscription:** back to the explanation page, with a "Reactivate" button instead of a trial offer.

## Apple approval

This does not put your update at risk, and it does not change your existing Apple setup.

- On iPhone the app already runs in a mode that hides all pricing, purchase buttons, and external payment links. Scout will follow the same rule: inside the iOS app a non-subscriber sees a neutral "Scout isn't active on this account" notice with no price and no link out. That is exactly the pattern Apple accepts (the "reader app" style notice) and it is what your other paid features already do.
- Nothing new is sold outside Apple's system from inside the app, so there is no 3.1.1 exposure.
- Optional follow-up (not part of this change): if you want iPhone users to be able to start the Scout trial in-app, that needs a new auto-renewing subscription product in App Store Connect plus RevenueCat wiring, and Apple takes its cut of it. Say the word and I'll plan that separately.

## Technical notes

- `PRODUCT_GATES.scout` flips from `legacy` to `strict` in `src/hooks/useEntitlements.ts`; Scout and Scout Inbox routes wrap in `EntitlementGate product="scout"`.
- Grandfathering: one-time migration inserting an `entitlements` row for `scout` with a `grandfathered` source and no expiry for every contractor who has used Scout (has scout captures/estimates) plus your account and its team members. This runs before the gate flips, so no one loses access.
- New Stripe product "TreeCheck Scout" with two prices: $50/mo owner base and $35/mo per additional seat. New edge function `create-scout-checkout` (subscription mode, `trial_period_days: 14`, card required, seat quantity from active team members) modelled on `create-trial-signup`/`create-marketing-checkout`.
- `stripe-webhook` gains handling for the Scout price: on `customer.subscription.created/updated` write/refresh the `scout` entitlement (status `trialing` or `active`, period end), and revoke on `deleted`/unpaid. Seat quantity syncs from the existing team-seat logic in `manage-team-seat`.
- `src/components/ScoutUpsell.tsx` for the web explanation + trial button; iOS keeps `SafeModeSubscriptionNotice`, so the App Store build shows no pricing.
- Menu items stay visible; the gate handles access, matching how DMA behaves.
