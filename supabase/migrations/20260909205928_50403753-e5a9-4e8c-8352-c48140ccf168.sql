-- Idempotent IAP webhook events + lead-unlock consumable claims
CREATE TABLE IF NOT EXISTS public.iap_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text,
  contractor_id uuid,
  product_id text,
  transaction_id text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.iap_lead_unlock_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  transaction_id text NOT NULL UNIQUE,
  consumed boolean NOT NULL DEFAULT false,
  lead_id uuid,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS iap_lead_unlock_credits_contractor_idx
  ON public.iap_lead_unlock_credits (contractor_id, consumed);

-- Service role only; edge functions do all reads/writes.
GRANT ALL ON public.iap_events TO service_role;
GRANT ALL ON public.iap_lead_unlock_credits TO service_role;

ALTER TABLE public.iap_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iap_lead_unlock_credits ENABLE ROW LEVEL SECURITY;

-- No public policies: contractors read their unlock state through existing lead APIs.
