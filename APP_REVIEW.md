# TreeCheck iOS — App Store Review Submission Pack

Last updated: August 2026

## 1. Reviewer demo account

| Field    | Value                                          |
|----------|------------------------------------------------|
| Email    | `appreview@treecheck.com`                      |
| Password | `Kfidid94#`                                    |
| Role     | Contractor (account owner)                     |
| Market   | Oklahoma City, OK                              |
| Tier     | Free — sample leads seeded                     |
| Seeded   | 3 sample accessible leads, incl. 1 Scout lead  |

**Seeding** — go to `/dashboard/admin/app-review` while logged in as admin and click **Seed / refresh demo account**.

## 2. App Store Connect Review Notes (paste verbatim)

> TreeCheck is a contractor lead-management and field-scouting app. On iOS, digital goods and subscriptions are sold through Apple In-App Purchase via RevenueCat (credit packs, lead unlock tiers, Marketing, DMA, and a 14-day introductory offer on the Demo plan). The iOS app does not use Stripe Checkout or ask users to complete purchases on an external website.
>
> Restore Purchases is available on Pricing and subscription screens.
>
> Financial Pulse (company owners only) is a read-only business dashboard: profit so far this month, costs by category and payroll cover, worked out from the owner's own business bank and card (linked through Plaid) and their Jobber account. Linking a bank or Jobber and changing settings happen on the TreeCheck website, not in the app; the app shows the numbers and lets the owner mark a payment as personal. Nothing is bought or sold and no money is moved. It appears in the menu only for owners whose company has it switched on, and it is switched on for the demo account above.
>
> Demo account (Sandbox Apple ID may be required to exercise IAP):
>
> Email: appreview@treecheck.com
> Password: Kfidid94#
>
> This demo account includes sample assigned leads so App Review can evaluate core workflows. For IAP testing, use a Sandbox Apple ID after signing in.

## 3. iOS commerce routes (when `VITE_IOS_USE_IAP=true`)

| Route | iOS behavior |
|-------|----------------|
| `/login` | Sign in + Register / Start Trial links |
| `/register` | Free account create (no Stripe) |
| `/start-trial` | Create account → App Store intro offer (`treecheck_demo_monthly`) |
| `/dashboard/pricing` | Credit packs via Apple IAP + Restore |
| `/dashboard` | Unlock with credits or nearest lead-unlock IAP tier |
| `/dashboard/marketing` | Marketing sub via Apple IAP |
| `/dashboard/dma` | DMA sub via Apple IAP |
| Stripe return URLs | Still blocked |

When `VITE_IOS_USE_IAP` is false, legacy safe mode applies (no commerce / optional external unlock).

## 4. Stripe edge functions blocked on iOS

`buy-credits`, `add-credits`, `setup-payment-method`, `check-payment-method`, `create-pro-checkout`, `create-marketing-checkout`, `create-dma-subscription`, `create-trial-signup`, `postgrid-send-postcard`, `manage-team-seat`.

Allowed on iOS with IAP: `purchase-lead` (credits-only), `iap-unlock-lead`.

See `canUseAppleIAP()` / `canUsePaymentFunction()` in `src/lib/platform.ts` and `docs/IAP_SETUP.md`.

## 5. App Store metadata audit

### Disallowed phrases — must NOT appear in title, subtitle, description, keywords, screenshots, or preview video
- buy leads, purchase leads, credits, top up, top-up, refill, wallet
- upgrade, subscribe, subscription, premium pricing, free trial
- $ amounts ($99, $250, $500, etc.)
- Stripe, checkout, billing, payment method
- "visit website to purchase", "purchase on the web", "activate on our website"
- Unlock for $___ , lead fee, discount

### Recommended copy

**App name** — TreeCheck

**Subtitle (≤30 chars)** — "Lead management for crews"

**Promotional text (≤170 chars)** — "Manage assigned tree-service leads, capture field opportunities with Scout, and stay on top of account activity from anywhere."

**Description (long)**
> TreeCheck is the companion app for approved TreeCheck contractor accounts.
>
> • Manage your TreeCheck contractor account
> • View and respond to assigned tree-service leads
> • Use Scout to capture field opportunities — photo, address, instant on-site estimate
> • Receive alerts for account activity
> • Quick access to customer contact, address, and job details
> • Built for approved TreeCheck contractor accounts
>
> An active contractor account is required to sign in. New customers can request access at treecheck.com.

**Keywords** — tree service, arborist, contractor leads, field tool, jobsite, crew, scout, OKC

**Support URL** — https://trccai.lovable.app/support
**Privacy URL** — https://trccai.lovable.app/privacy

### Screenshot captions — approved set
1. "Your assigned leads, in one place"
2. "Tap to call, text, or get directions"
3. "Scout: capture a tree from the field"
4. "Instant on-site estimate, ready to share"
5. "Stay notified about new account activity"

### Disallowed screenshot content
- No pricing tables
- No "$" amounts
- No "Buy / Upgrade / Subscribe" buttons
- No Stripe checkout screens
- No wallet / credit-balance widgets
- No "Go Premium" / "Start trial" banners

## 6. Pre-flight acceptance checklist

- [ ] Financial Pulse for App Review: switch it on for the demo account (Admin > Financial Pulse, Test banks) and set it up on the website with Plaid's test bank, so the reviewer sees the screen; check the App Privacy answers (Financial Info: Other Financial Info, linked to the user, App Functionality) and Google Play's Data safety and Financial features answers.
Run the diagnostics page at `/dashboard/admin/app-review` from a TestFlight build signed in as admin. All checks must be green:

- [ ] Native iOS detected
- [ ] App Store safe mode active
- [ ] Payment UI hidden
- [ ] All 13 payment edge functions disabled
- [ ] All 16 purchase routes blocked
- [ ] Backend reachable (entitlements RPC returns)
- [ ] Mobile access enabled for signed-in user
- [ ] Reviewer account exists
- [ ] Reviewer has ≥3 accessible leads
- [ ] DOM purchase-string scan: 0 leaking

Then sign in as `appreview@treecheck.com` and manually verify:

- [ ] Login succeeds
- [ ] Session persists after app force-quit + relaunch
- [ ] Dashboard loads with assigned leads
- [ ] Lead detail shows customer contact (already-entitled)
- [ ] No "Unlock", "Buy", "Upgrade", "Pricing", "Stripe", "Wallet", or "$ paid" text appears
- [ ] Scout capture flow works without payment prompt
- [ ] Push permission denial does not crash the app

## 7. Notes for the reviewer (in-app, optional)

If Apple flags lack of context, point to: app behaves as a free companion to an existing B2B web service. All commerce is performed on the web platform by authorized contractor accounts; the iOS app surfaces only already-provisioned data.

## 6. Push notifications (App Store safe mode)

TreeCheck uses push notifications only for operational account activity, such as
assigned leads or updates to leads already available to the logged-in contractor
account. Push notifications do not contain payment prompts, pricing, billing
links, external purchase links, or sensitive homeowner contact information. The
app does not require push notification permission to function.

### Allowed iOS notification types

`lead_assigned`, `lead_unlocked_elsewhere`, `lead_updated`, `scout_lead_created`,
`message_or_response_update`, `account_activity_non_payment`,
`reminder_for_existing_accessible_lead`.

### Blocked for iOS (gateway-enforced)

`marketplace_lead_available_to_buy`, `unlock_lead`, `buy_credits`, `top_up_wallet`,
`upgrade_to_premium`, `subscribe_*`, `postcard_purchase`,
`billing_failed_with_upgrade_cta`, and the legacy `new_lead` marketplace teaser.

### Enforcement layer

`supabase/functions/send-push/index.ts` is the only path to FCM. For every iOS
token it:

1. Drops the message if `notification_type` is not in the iOS whitelist.
2. Calls the `mobile_can_access_lead` RPC and drops the message if access is not
   confirmed for the contractor.
3. Replaces caller copy with neutral templates (see `iosCopyFor`).
4. Strips the data payload to a safe whitelist — no PII, no Stripe IDs, no price.
5. Honors per-device `lead_alerts_enabled` / `account_alerts_enabled` toggles.
6. Audits every send/block decision into `public.notification_events`.

### Tap behavior

`src/hooks/usePushNotifications.ts` re-checks entitlement via
`mobile_can_access_lead` before navigating to a lead. On miss it shows
"This lead is not currently available for this account." and returns the user
to Your Leads. No purchase UI is ever opened from a tap.

### Settings

`/dashboard/notifications` exposes only operational toggles (Lead alerts,
Account alerts). Marketing/promotional push is **not implemented** in the first
App Review iOS build.

---

## US-Storefront External Purchase Flow

TreeCheck is a contractor lead-management app. In the United States storefront,
the app may show lead previews and provide a link to TreeCheck's website where
contractors can complete account transactions. The iOS app does not collect
payment information, does not process Stripe payments, does not deduct credits,
and does not reveal paid lead contact information until backend access is
confirmed in Supabase. All transactions occur on TreeCheck's website.

Flow:
1. iOS shows a lead preview with city, job type, photo, estimated job value
   range, lead age, and the current unlock fee.
2. Tapping "Unlock This Lead" calls `create-mobile-lead-unlock-intent`, which
   returns a short-lived URL on `https://trccai.lovable.app/mobile/unlock`.
3. The app opens that URL in a system browser sheet via Capacitor Browser.
   Payment is collected on the website.
4. On success the website opens `treecheck://lead-unlocked?lead_id=...`
   (or the universal link `/app/lead-unlocked`). The app refreshes Supabase
   entitlements and shows the unlocked lead in Your Leads.
5. Homeowner name, phone, and exact address are only revealed after Supabase
   confirms the contractor has access.

Feature flags:
- `VITE_APP_STORE_SAFE_MODE=true`
- `VITE_IOS_EXTERNAL_PURCHASE_LINKS_ALLOWED=true`
- `VITE_IOS_EXTERNAL_PURCHASE_LINK_REGION=US`
- `VITE_TREECHECK_WEB_BASE_URL=https://app.treecheck.ai`

If external links are disabled (non-US storefronts), the app falls back to
strict safe mode with no unlock CTA or pricing shown.
