-- Create profiles table for contractors and admins
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  company_name TEXT,
  role TEXT NOT NULL DEFAULT 'contractor' CHECK (role IN ('admin', 'contractor')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create service_areas table
CREATE TABLE public.service_areas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contractor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  city TEXT NOT NULL,
  region TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(contractor_id, city)
);

-- Create leads table
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  photo_url TEXT NOT NULL,
  city TEXT NOT NULL,
  estimated_cost_min DECIMAL(10,2) NOT NULL,
  estimated_cost_max DECIMAL(10,2) NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold_out', 'expired')),
  purchase_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create lead_purchases table
CREATE TABLE public.lead_purchases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  purchase_amount DECIMAL(10,2) NOT NULL,
  purchased_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(lead_id, contractor_id)
);

-- Create invitations table
CREATE TABLE public.invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  invite_token UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(email),
  UNIQUE(invite_token)
);

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper function to check if contractor serves a city
CREATE OR REPLACE FUNCTION public.is_contractor_in_service_area(lead_city TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.service_areas 
    WHERE contractor_id = auth.uid() 
    AND LOWER(city) = LOWER(lead_city)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper function to check if contractor purchased a lead
CREATE OR REPLACE FUNCTION public.has_purchased_lead(p_lead_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.lead_purchases 
    WHERE lead_id = p_lead_id AND contractor_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper function to check if lead can still be purchased
CREATE OR REPLACE FUNCTION public.can_purchase_lead(p_lead_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  lead_record RECORD;
BEGIN
  SELECT purchase_count, status INTO lead_record 
  FROM public.leads WHERE id = p_lead_id;
  
  RETURN lead_record.purchase_count < 5 AND lead_record.status = 'available';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to update purchase_count and status on leads
CREATE OR REPLACE FUNCTION public.update_lead_purchase_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.leads 
  SET purchase_count = purchase_count + 1,
      status = CASE WHEN purchase_count + 1 >= 5 THEN 'sold_out' ELSE status END
  WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER on_lead_purchase
AFTER INSERT ON public.lead_purchases
FOR EACH ROW EXECUTE FUNCTION public.update_lead_purchase_count();

-- Trigger to update updated_at on profiles
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (id = auth.uid());

-- Service areas policies
CREATE POLICY "Contractors can view their own service areas"
ON public.service_areas FOR SELECT
USING (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Contractors can manage their own service areas"
ON public.service_areas FOR INSERT
WITH CHECK (contractor_id = auth.uid());

CREATE POLICY "Contractors can update their own service areas"
ON public.service_areas FOR UPDATE
USING (contractor_id = auth.uid());

CREATE POLICY "Contractors can delete their own service areas"
ON public.service_areas FOR DELETE
USING (contractor_id = auth.uid());

-- Leads policies
CREATE POLICY "Admins can do everything with leads"
ON public.leads FOR ALL
USING (public.is_admin());

CREATE POLICY "Contractors can view leads in their service area"
ON public.leads FOR SELECT
USING (public.is_contractor_in_service_area(city));

-- Lead purchases policies
CREATE POLICY "Contractors can view their own purchases"
ON public.lead_purchases FOR SELECT
USING (contractor_id = auth.uid() OR public.is_admin());

CREATE POLICY "Contractors can purchase leads"
ON public.lead_purchases FOR INSERT
WITH CHECK (
  contractor_id = auth.uid() 
  AND public.is_contractor_in_service_area((SELECT city FROM public.leads WHERE id = lead_id))
  AND public.can_purchase_lead(lead_id)
);

-- Invitations policies
CREATE POLICY "Only admins can manage invitations"
ON public.invitations FOR ALL
USING (public.is_admin());