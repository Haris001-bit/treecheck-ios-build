# Apply subscription tier expansion migration

Apply the migration file that was just added:

- File: `supabase/migrations/20260910120000_profiles_subscription_tier_iap_values.sql`
- Change: expand `profiles.subscription_tier` to allow `free`, `pro`, `premium`, `demo_trial`, `demo_paid`.
- Impact: no rows are deleted or modified; only the allowed-values check is updated so the RevenueCat webhook and IAP credit-pack flow can write the new tier values.

No other code or database changes are included.
