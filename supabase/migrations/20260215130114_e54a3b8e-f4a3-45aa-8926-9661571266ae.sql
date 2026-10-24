
-- Add credit_balance to profiles
ALTER TABLE public.profiles ADD COLUMN credit_balance numeric NOT NULL DEFAULT 0;

-- Create premium_rotation table to track which 3 premium members get early access
CREATE TABLE public.premium_rotation (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contractor_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  position integer NOT NULL, -- 1, 2, or 3
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '90 minutes')
);

ALTER TABLE public.premium_rotation ENABLE ROW LEVEL SECURITY;

-- Contractors can see their own rotation assignments
CREATE POLICY "Contractors can view their own rotation"
  ON public.premium_rotation FOR SELECT
  USING (contractor_id = auth.uid() OR is_admin());

-- Create credit_transactions table for audit trail
CREATE TABLE public.credit_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contractor_id uuid NOT NULL,
  amount numeric NOT NULL, -- positive = credit added, negative = credit spent
  type text NOT NULL, -- 'purchase', 'lead_unlock', 'premium_subscription', 'refund'
  description text,
  lead_id uuid,
  stripe_payment_intent_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors can view their own transactions"
  ON public.credit_transactions FOR SELECT
  USING (contractor_id = auth.uid() OR is_admin());

-- Index for rotation lookups
CREATE INDEX idx_premium_rotation_lead ON public.premium_rotation (lead_id, expires_at);
CREATE INDEX idx_premium_rotation_contractor ON public.premium_rotation (contractor_id);
CREATE INDEX idx_credit_transactions_contractor ON public.credit_transactions (contractor_id);
