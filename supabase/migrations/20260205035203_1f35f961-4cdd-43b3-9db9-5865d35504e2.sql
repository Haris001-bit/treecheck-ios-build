-- Add subscription tracking fields to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
ADD COLUMN IF NOT EXISTS subscription_ends_at timestamptz;

-- Create index for subscription queries
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier ON public.profiles(subscription_tier);

-- Comment for documentation
COMMENT ON COLUMN public.profiles.subscription_tier IS 'User subscription tier: free (5% fee) or pro (2.5% fee)';
COMMENT ON COLUMN public.profiles.subscription_ends_at IS 'When the pro subscription expires';