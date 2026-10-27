ALTER TABLE public.giveaway_entries ADD COLUMN status text NOT NULL DEFAULT 'entered' CHECK (status IN ('entered', 'awaiting_trial'));
ALTER TABLE public.giveaway_entries ALTER COLUMN consent_version DROP NOT NULL;
ALTER TABLE public.giveaway_entries ALTER COLUMN consent_text DROP NOT NULL;
COMMENT ON COLUMN public.giveaway_entries.status IS 'entered = the 14-day trial started; awaiting_trial = signed up and sent to card checkout, entered once the trial starts (checked by giveaway-draw).';