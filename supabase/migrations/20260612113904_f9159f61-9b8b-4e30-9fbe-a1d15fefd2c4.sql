
CREATE TABLE IF NOT EXISTS public.pending_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  product text NOT NULL,
  status text NOT NULL,
  seat_count integer NOT NULL DEFAULT 1,
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, product)
);
GRANT ALL ON public.pending_entitlements TO service_role;
ALTER TABLE public.pending_entitlements ENABLE ROW LEVEL SECURITY;
