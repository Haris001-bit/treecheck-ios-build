ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_sub ON public.profiles(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;