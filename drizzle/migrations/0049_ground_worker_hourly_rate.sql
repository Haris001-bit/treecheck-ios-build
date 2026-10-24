ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS hourly_rate numeric;
ALTER TABLE public.crew_profiles ADD COLUMN IF NOT EXISTS hourly_rate numeric;
ALTER TABLE public.crew_members ADD CONSTRAINT crew_members_hourly_rate_range CHECK (hourly_rate IS NULL OR (hourly_rate >= 0 AND hourly_rate <= 200));
ALTER TABLE public.crew_profiles ADD CONSTRAINT crew_profiles_hourly_rate_range CHECK (hourly_rate IS NULL OR (hourly_rate >= 0 AND hourly_rate <= 200));