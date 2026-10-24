-- CR1: one alert to Mark (text and email) per company and CRM when an owner says in company setup that they use a CRM other than
-- Jobber (App Improvements; Mark, 2026-10-22: "program the app to alert us so that we can call them and get them set
-- up"), 2026-10-22. Reference SQL. Applied through Lovable (TreeCheck project) exactly as written. Safe to apply twice.
--
-- * crm_interest_alerts: which company was already flagged for which CRM, so saving setup again, or two quick calls,
--   never alerts Mark twice. Written only by the crm-interest-alert function (service role). No browser access at all,
--   so its "RLS enabled, no policy" warning is intentional.

create table if not exists public.crm_interest_alerts (
  contractor_id uuid not null references public.profiles(id) on delete cascade,
  crm_key text not null check (char_length(crm_key) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (contractor_id, crm_key)
);

alter table public.crm_interest_alerts enable row level security;
revoke all on public.crm_interest_alerts from public, anon, authenticated;
grant select, insert, update, delete on public.crm_interest_alerts to service_role;
