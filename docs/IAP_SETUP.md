# Apple IAP + RevenueCat setup checklist

Complete these outside the repo before TestFlight IAP works. Code expects the product IDs below.

## 1. App Store Connect

1. Paid Applications Agreement + banking + tax completed.
2. App bundle ID: `com.treecheck.app`.
3. Xcode target: enable **In-App Purchase** capability.
4. Create products:

### Consumables — credits

| Product ID | Price | Notes |
|------------|-------|--------|
| `treecheck_credits_250` | $249.99 or $250 tier | Credit pack |
| `treecheck_credits_500` | $499.99 or $500 tier | Premium / Pro credits + premium flags via webhook |

### Consumables — lead unlock ladder

| Product ID | Price |
|------------|-------|
| `treecheck_lead_unlock_5` | $4.99 |
| `treecheck_lead_unlock_10` | $9.99 |
| `treecheck_lead_unlock_15` | $14.99 |
| `treecheck_lead_unlock_25` | $24.99 |
| `treecheck_lead_unlock_40` | $39.99 |
| `treecheck_lead_unlock_60` | $59.99 |
| `treecheck_lead_unlock_100` | $99.99 |

### Auto-renewable subscriptions

| Product ID | Price | Group | Intro offer |
|------------|-------|-------|-------------|
| `treecheck_marketing_monthly` | $99/mo | Marketing | — |
| `treecheck_dma_monthly` | Match Stripe DMA | DMA | — |
| `treecheck_demo_monthly` | $50/mo | Demo | **14 days free** |

5. Create Sandbox Apple IDs.
6. Submit IAPs with the next app binary.
7. Update App Privacy nutrition labels (purchase history).
8. Review notes: list IAP catalog, Restore Purchases, no Stripe in binary, lead tier explanation.

## 2. RevenueCat

1. Create project; add iOS app `com.treecheck.app`.
2. Upload App Store Connect API key (In-App Purchase).
3. Import all product IDs above.
4. Entitlements: `marketing`, `dma`, `demo`.
5. Offerings:
   - `default`: credits 250, credits 500, marketing, DMA, demo
   - `lead_unlock`: all `treecheck_lead_unlock_*` packages
6. Webhook URL: `https://<SUPABASE_PROJECT>.supabase.co/functions/v1/revenuecat-webhook`
7. Authorization: Bearer / shared secret → set Supabase secret `REVENUECAT_WEBHOOK_SECRET`
8. Also set `REVENUECAT_API_KEY` (secret key) for server-side transaction verification on lead unlock.
9. Public SDK key → `VITE_REVENUECAT_IOS_API_KEY` in `.env`

## 3. App env flags

```bash
VITE_IOS_USE_IAP=true
VITE_REVENUECAT_IOS_API_KEY=appl_xxxxx
# When IAP is on, external Safari unlock is disabled automatically in code.
VITE_IOS_EXTERNAL_PURCHASE_LINKS_ALLOWED=false
```

## 4. After config

```bash
npm run build
npx cap sync ios
# Xcode: confirm In-App Purchase capability, run on device with Sandbox Apple ID
```
