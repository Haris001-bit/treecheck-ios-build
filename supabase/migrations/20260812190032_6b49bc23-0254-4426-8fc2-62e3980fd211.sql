-- Swap owner/member between the two linked Mark accounts
-- new owner: 705cecc2-5926-48c1-a728-b3ebd6b920a2 (mark@timberedmond.com)
-- new member: cf93d0f4-9365-4352-b0cb-10ce93646843 (mark@tradesmarketing.ai)

ALTER TABLE public.profiles DISABLE TRIGGER trg_protect_profile_payment_fields;

-- 1) Flip the parent pointers
UPDATE public.profiles
SET parent_contractor_id = NULL
WHERE id = '705cecc2-5926-48c1-a728-b3ebd6b920a2';

UPDATE public.profiles
SET parent_contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE id = 'cf93d0f4-9365-4352-b0cb-10ce93646843';

-- Any other members that pointed at the old owner now point at the new owner
UPDATE public.profiles
SET parent_contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE parent_contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843'
  AND id <> '705cecc2-5926-48c1-a728-b3ebd6b920a2';

-- 2) Move account-level entitlements/tier/credits to the new owner
UPDATE public.profiles p
SET subscription_tier = old.subscription_tier,
    subscription_ends_at = old.subscription_ends_at,
    trial_ends_at = COALESCE(p.trial_ends_at, old.trial_ends_at),
    is_founder = old.is_founder,
    dma_beta_enabled = p.dma_beta_enabled OR old.dma_beta_enabled,
    credit_balance = p.credit_balance + old.credit_balance
FROM public.profiles old
WHERE p.id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
  AND old.id = 'cf93d0f4-9365-4352-b0cb-10ce93646843';

UPDATE public.profiles
SET credit_balance = 0,
    subscription_tier = 'free',
    subscription_ends_at = NULL
WHERE id = 'cf93d0f4-9365-4352-b0cb-10ce93646843';

ALTER TABLE public.profiles ENABLE TRIGGER trg_protect_profile_payment_fields;

-- 3) Move shared account data to the new owner
UPDATE public.leads
SET owner_contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE owner_contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843';

UPDATE public.lead_purchases
SET contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843'
  AND lead_id NOT IN (
    SELECT lead_id FROM public.lead_purchases
    WHERE contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
  );

DELETE FROM public.lead_purchases
WHERE contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843';

UPDATE public.dma_integrations
SET contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843'
  AND NOT EXISTS (
    SELECT 1 FROM public.dma_integrations d2
    WHERE d2.contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
  );

UPDATE public.dma_published_projects
SET contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843';

UPDATE public.dma_project_revisions
SET contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843';

UPDATE public.product_entitlements
SET contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843'
  AND product NOT IN (
    SELECT product FROM public.product_entitlements
    WHERE contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
  );

UPDATE public.lead_closeouts
SET contractor_id = '705cecc2-5926-48c1-a728-b3ebd6b920a2'
WHERE contractor_id = 'cf93d0f4-9365-4352-b0cb-10ce93646843';
