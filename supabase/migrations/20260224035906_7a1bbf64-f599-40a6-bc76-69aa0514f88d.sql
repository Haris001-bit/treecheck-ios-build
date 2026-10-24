
-- Applications table for contractor applications
CREATE TABLE public.applications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  company_name text NOT NULL,
  city text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

-- Only admins can view/manage applications
CREATE POLICY "Admins can do everything with applications"
  ON public.applications FOR ALL
  USING (is_admin());

-- Public can insert (submit applications)
CREATE POLICY "Anyone can submit applications"
  ON public.applications FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
