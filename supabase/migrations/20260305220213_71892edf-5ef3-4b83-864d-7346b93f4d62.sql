
-- Marketing profiles table
CREATE TABLE public.marketing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url text,
  bio text,
  isa_certified boolean DEFAULT false,
  isa_credentials text,
  website_url text,
  is_active boolean DEFAULT false,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contractor_id)
);

ALTER TABLE public.marketing_profiles ENABLE ROW LEVEL SECURITY;

-- Contractors can view their own marketing profile
CREATE POLICY "Users can view own marketing profile"
  ON public.marketing_profiles FOR SELECT
  USING (contractor_id = auth.uid() OR is_admin());

-- Contractors can insert their own marketing profile
CREATE POLICY "Users can insert own marketing profile"
  ON public.marketing_profiles FOR INSERT
  WITH CHECK (contractor_id = auth.uid());

-- Contractors can update their own marketing profile
CREATE POLICY "Users can update own marketing profile"
  ON public.marketing_profiles FOR UPDATE
  USING (contractor_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_marketing_profiles_updated_at
  BEFORE UPDATE ON public.marketing_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Storage bucket for marketing photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-photos', 'marketing-photos', false);

-- Storage policies for marketing photos
CREATE POLICY "Contractors can upload marketing photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'marketing-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Contractors can view marketing photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'marketing-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Contractors can update their marketing photos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'marketing-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Contractors can delete their marketing photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'marketing-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
