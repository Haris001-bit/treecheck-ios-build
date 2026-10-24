UPDATE public.leads
SET owner_contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843',
    status = 'sold_out'
WHERE source = 'public_from_Mark Cafiero (Timber Tree Services)'
  AND status = 'available'
  AND owner_contractor_id IS NULL;