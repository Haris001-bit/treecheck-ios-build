ALTER TABLE public.profiles DISABLE TRIGGER USER;
UPDATE public.profiles SET parent_contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843' WHERE id = '705cecc2-5926-48c1-a728-b3ebd6b920a2';
ALTER TABLE public.profiles ENABLE TRIGGER USER;