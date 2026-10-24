-- Allow IAP / Stripe tiers used by revenuecat-webhook and app logic.
-- credits_500 sets subscription_tier = 'premium'; demo IAP uses demo_trial / demo_paid.
-- Old check only allowed ('free', 'pro'), so premium credit purchases failed silently.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'pro', 'premium', 'demo_trial', 'demo_paid'));

COMMENT ON COLUMN public.profiles.subscription_tier IS
  'User subscription tier: free, pro, premium (credit pack), demo_trial, demo_paid';