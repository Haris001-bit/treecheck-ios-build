-- Add stripe_customer_id to profiles for saved card functionality
ALTER TABLE public.profiles 
ADD COLUMN stripe_customer_id text;

-- Add index for faster lookups
CREATE INDEX idx_profiles_stripe_customer_id ON public.profiles(stripe_customer_id);