-- Rollback for PS1. Remove (or stop deploying) the production-* functions first: without these tables they answer 500.
-- Safe to run twice. Everything the large-company setup stored is lost: settings, rate cards, estimates, costs and
-- packets. Mark's production cost tables go back to their 0017/0018 access exactly, and production_equipment loses the
-- unit column (any 'each' or 'job' rows then cost by the hour again).

do $$
declare t text;
begin
  foreach t in array array['production_labor_roles', 'production_equipment', 'production_pricing',
                           'production_plans', 'production_pricing_history'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'Production costs layer read', t);
      execute format('drop policy if exists %I on public.%I', 'Production costs layer add', t);
      execute format('drop policy if exists %I on public.%I', 'Production costs layer change', t);
      execute format('drop policy if exists %I on public.%I', 'Production costs layer remove', t);
    end if;
  end loop;
end $$;

drop table if exists public.production_packets;
drop table if exists public.production_estimate_costs;
drop table if exists public.production_estimates;
drop table if exists public.production_rate_cards;
drop table if exists public.production_settings;
drop table if exists public.production_rollout;

drop function if exists public.production_status();
drop function if exists public.production_costs_open(uuid, boolean);
drop function if exists public.production_can(uuid, text);
drop function if exists public.production_has_key(uuid, text);
drop function if exists public.production_row_touch();
drop function if exists public.production_estimate_freeze();
drop function if exists public.production_rate_card_freeze();
drop function if exists public.production_settings_guard();

alter table if exists public.production_equipment drop constraint if exists production_equipment_unit_check;
alter table if exists public.production_equipment drop column if exists unit;
