-- PS1: the large-company setup's tables (large-company setup, approved by Mark 2026-10-23), 2026-10-26.
-- Reference SQL. Applied through Lovable (TreeCheck project) as the next drizzle migration, exactly as written.
-- Safe to apply twice. Touches no Financial Pulse table or function. Read-back: checks/readback_PS1.sql.
-- Rollback: down/PS1_production_setup.down.sql.
--
-- Companies that run their own crews get versioned rate cards, crew estimates, internal costs and production packets.
-- Nothing changes for any company until it is in the rollout, runs its own crews (company_settings.operating_model
-- 'employees' or 'hybrid') and starts the setup. Subcontractor companies (Timber) never see any of it.
--
-- * production_rollout: one sealed row. live opens it to every crew company; test_owner_ids opens it to listed owners
--   first; jobber_extras turns on the Jobber parts that need permissions the Jobber app gets after Jobber's review.
--   Haris changes it in the SQL editor only.
-- * production_settings: one row per company once setup starts (basics, crews, resources, who sees costs).
-- * production_rate_cards: versioned rate cards. Drafts are edited in the browser; publishing goes through the
--   production-setup function; a published card never changes (only published to archived).
-- * production_estimates, production_estimate_costs, production_packets: written only by the production-* functions
--   (service role). Packets have no price column: crew leaders read them.
-- * production_can(owner, layer): who may do what. price (createScout or reviewEstimates), setup (operationalSettings),
--   dispatch (manageJobsSubs), field (assignedJobs), costs (the owner, or a cost viewer the owner picked who also holds
--   price, setup or dispatch). As in 0048: company_has_permission AND (the owner OR an active employee row holding the
--   key), so on legacy plans only the owner gets crew features.
-- * Costs overlay: Mark's production cost tables become cost-layer only, but only for companies that started setup
--   (a production_settings row exists). Every other company keeps exactly today's access.
-- * production_equipment.unit: hour, each or job, so materials and vendor fees cost through the same engine.

-- ---------------------------------------------------------------------------
-- 1. The rollout switch (service_role only; read through production_status)
-- ---------------------------------------------------------------------------
create table if not exists public.production_rollout (
  id int primary key default 1 check (id = 1),
  live boolean not null default false,
  test_owner_ids uuid[] not null default '{}',
  jobber_extras boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.production_rollout (id) values (1) on conflict (id) do nothing;
alter table public.production_rollout enable row level security;
revoke all on public.production_rollout from public, anon, authenticated;
grant select, insert, update on public.production_rollout to service_role;

-- ---------------------------------------------------------------------------
-- 2. Company settings (one row once setup starts)
-- ---------------------------------------------------------------------------
create table if not exists public.production_settings (
  contractor_id uuid primary key references public.profiles(id) on delete cascade,
  basics jsonb not null default '{}'::jsonb,
  crew_counts jsonb not null default '{}'::jsonb,
  resources jsonb not null default '[]'::jsonb,
  cost_viewer_ids uuid[] not null default '{}',
  send_unit_cost boolean not null default false,
  isa_credentials jsonb not null default '{}'::jsonb,
  active_profile text not null default 'normal' check (char_length(active_profile) between 1 and 40),
  profile_schedule jsonb not null default '[]'::jsonb,
  jobber jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_settings_shapes check (
    jsonb_typeof(basics) = 'object' and jsonb_typeof(crew_counts) = 'object' and jsonb_typeof(resources) = 'array'
    and jsonb_typeof(isa_credentials) = 'object' and jsonb_typeof(profile_schedule) = 'array'
    and jsonb_typeof(jobber) = 'object'),
  constraint production_settings_sizes check (
    octet_length(basics::text) <= 20000 and octet_length(crew_counts::text) <= 20000
    and octet_length(resources::text) <= 50000 and octet_length(isa_credentials::text) <= 20000
    and octet_length(profile_schedule::text) <= 20000 and octet_length(jobber::text) <= 50000
    and cardinality(cost_viewer_ids) <= 50)
);

-- Only the owner (or the server) decides who sees costs and whether costs go to Jobber; jobber is server-only.
create or replace function public.production_settings_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.contractor_id := old.contractor_id;
    new.created_at := old.created_at;
  end if;
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.jobber := '{}'::jsonb;
      if auth.uid() is distinct from new.contractor_id
         and (cardinality(new.cost_viewer_ids) > 0 or new.send_unit_cost) then
        raise exception 'Only the company owner can choose who sees costs.';
      end if;
    else
      new.jobber := old.jobber;
      if auth.uid() is distinct from new.contractor_id
         and (new.cost_viewer_ids is distinct from old.cost_viewer_ids or new.send_unit_cost is distinct from old.send_unit_cost) then
        raise exception 'Only the company owner can choose who sees costs.';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists production_settings_guard on public.production_settings;
create trigger production_settings_guard before insert or update on public.production_settings
  for each row execute function public.production_settings_guard();

-- ---------------------------------------------------------------------------
-- 3. Rate cards (versioned; a published card never changes)
-- ---------------------------------------------------------------------------
create table if not exists public.production_rate_cards (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default '' check (char_length(label) <= 120),
  branch_key text check (branch_key is null or char_length(branch_key) between 1 and 40),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version int check (version is null or version between 1 and 100000),
  effective_from date,
  published_at timestamptz,
  published_by uuid,
  based_on uuid references public.production_rate_cards(id) on delete set null,
  pricing_engine_version text check (pricing_engine_version is null or char_length(pricing_engine_version) <= 40),
  definition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_rate_cards_definition check (
    jsonb_typeof(definition) = 'object' and octet_length(definition::text) <= 500000),
  constraint production_rate_cards_published_complete check (
    status = 'draft' or (version is not null and effective_from is not null and published_at is not null
                         and pricing_engine_version is not null))
);
create unique index if not exists production_rate_cards_version
  on public.production_rate_cards (contractor_id, version) where version is not null;
create unique index if not exists production_rate_cards_one_draft
  on public.production_rate_cards (contractor_id, coalesce(branch_key, '')) where status = 'draft';
create index if not exists production_rate_cards_company
  on public.production_rate_cards (contractor_id, status, effective_from desc);

-- A non-draft card is frozen: the only changes allowed are published -> archived, and based_on cleared (when the card it
-- came from is deleted, for example with the whole company). Browsers may only delete drafts.
create or replace function public.production_rate_card_freeze() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' and current_user in ('authenticated', 'anon') then
      raise exception 'A published rate card can''t be deleted.';
    end if;
    return old;
  end if;
  new.contractor_id := old.contractor_id;
  new.created_at := old.created_at;
  if old.status <> 'draft' then
    if (new.status = old.status or (old.status = 'published' and new.status = 'archived'))
       and (new.based_on is not distinct from old.based_on or new.based_on is null)
       and new.definition = old.definition and new.label = old.label
       and new.version is not distinct from old.version and new.effective_from is not distinct from old.effective_from
       and new.branch_key is not distinct from old.branch_key and new.published_at is not distinct from old.published_at
       and new.published_by is not distinct from old.published_by
       and new.pricing_engine_version is not distinct from old.pricing_engine_version then
      new.updated_at := now();
      return new;
    end if;
    raise exception 'A published rate card can''t be changed. Make a new version instead.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists production_rate_card_freeze on public.production_rate_cards;
create trigger production_rate_card_freeze before update or delete on public.production_rate_cards
  for each row execute function public.production_rate_card_freeze();

-- ---------------------------------------------------------------------------
-- 4. Estimates (written by production-estimate only)
-- ---------------------------------------------------------------------------
create table if not exists public.production_estimates (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.profiles(id) on delete cascade,
  number int not null check (number between 1 and 100000000),
  revision_of uuid references public.production_estimates(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'changes_requested', 'approved', 'lost', 'archived')),
  salesperson_id uuid references public.profiles(id) on delete set null,
  branch_key text check (branch_key is null or char_length(branch_key) between 1 and 40),
  customer jsonb not null default '{}'::jsonb,
  trees jsonb not null default '[]'::jsonb,
  work_items jsonb not null default '[]'::jsonb,
  rate_card_id uuid not null references public.production_rate_cards(id),
  rate_card_version int,
  pricing_engine_version text not null check (char_length(pricing_engine_version) <= 40),
  production_engine_version text not null check (char_length(production_engine_version) <= 40),
  profile text not null default 'normal' check (char_length(profile) between 1 and 40),
  totals jsonb not null default '{}'::jsonb,
  payment_plan jsonb,
  consultation jsonb,
  promised_window jsonb,
  sent_snapshot jsonb,
  sent_at timestamptz,
  backlog_weeks_at_send numeric,
  backlog_weeks_at_sale numeric,
  jobber_client_id text check (jobber_client_id is null or char_length(jobber_client_id) <= 200),
  jobber_property_id text check (jobber_property_id is null or char_length(jobber_property_id) <= 200),
  jobber_quote_id text check (jobber_quote_id is null or char_length(jobber_quote_id) <= 200),
  jobber_quote_number text check (jobber_quote_number is null or char_length(jobber_quote_number) <= 40),
  quote_state text check (quote_state in ('creating', 'pending', 'failed', 'uncertain', 'not_created')),
  quote_claimed_at timestamptz,
  quote_error text check (quote_error is null or char_length(quote_error) <= 500),
  approved_at timestamptz,
  approved_via text check (approved_via in ('jobber', 'manual')),
  approved_by uuid,
  lost_at timestamptz,
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 300),
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_estimates_number unique (contractor_id, number),
  constraint production_estimates_shapes check (
    jsonb_typeof(customer) = 'object' and jsonb_typeof(trees) = 'array' and jsonb_typeof(work_items) = 'array'
    and jsonb_typeof(totals) = 'object'),
  constraint production_estimates_sizes check (
    octet_length(customer::text) <= 10000 and octet_length(trees::text) <= 200000
    and octet_length(work_items::text) <= 400000 and octet_length(totals::text) <= 20000
    and coalesce(octet_length(sent_snapshot::text), 0) <= 600000
    and coalesce(octet_length(payment_plan::text), 0) <= 20000
    and coalesce(octet_length(consultation::text), 0) <= 20000
    and coalesce(octet_length(promised_window::text), 0) <= 2000)
);
create unique index if not exists production_estimates_jobber_quote
  on public.production_estimates (jobber_quote_id) where jobber_quote_id is not null;
create index if not exists production_estimates_company
  on public.production_estimates (contractor_id, status, created_at desc);
create index if not exists production_estimates_rate_card on public.production_estimates (rate_card_id);

-- Once sent, what was quoted never changes: the snapshot, the card, the engine versions and the profile.
create or replace function public.production_estimate_freeze() returns trigger
language plpgsql set search_path = public as $$
begin
  new.contractor_id := old.contractor_id;
  new.number := old.number;
  new.created_at := old.created_at;
  if old.sent_at is not null then
    new.sent_at := old.sent_at;
    new.sent_snapshot := old.sent_snapshot;
    new.rate_card_id := old.rate_card_id;
    new.rate_card_version := old.rate_card_version;
    new.pricing_engine_version := old.pricing_engine_version;
    new.production_engine_version := old.production_engine_version;
    new.profile := old.profile;
    new.backlog_weeks_at_send := old.backlog_weeks_at_send;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists production_estimate_freeze on public.production_estimates;
create trigger production_estimate_freeze before update on public.production_estimates
  for each row execute function public.production_estimate_freeze();

-- ---------------------------------------------------------------------------
-- 5. Internal costs (cost layer only)
-- ---------------------------------------------------------------------------
create table if not exists public.production_estimate_costs (
  estimate_id uuid primary key references public.production_estimates(id) on delete cascade,
  contractor_id uuid not null references public.profiles(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  rates jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_estimate_costs_shapes check (
    jsonb_typeof(items) = 'array' and jsonb_typeof(totals) = 'object' and jsonb_typeof(rates) = 'object'
    and octet_length(items::text) <= 200000 and octet_length(totals::text) <= 20000
    and octet_length(rates::text) <= 50000)
);
create index if not exists production_estimate_costs_company on public.production_estimate_costs (contractor_id);

-- ---------------------------------------------------------------------------
-- 6. Production packets (no price column; crew leaders read their own)
-- ---------------------------------------------------------------------------
create table if not exists public.production_packets (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.profiles(id) on delete cascade,
  estimate_id uuid not null references public.production_estimates(id) on delete cascade,
  package_key text not null check (char_length(package_key) between 1 and 40),
  title text not null default '' check (char_length(title) <= 200),
  fulfillment text not null default 'internal' check (fulfillment in ('internal', 'subcontractor', 'vendor', 'hybrid')),
  salesperson_name text check (salesperson_name is null or char_length(salesperson_name) <= 120),
  estimate_number int,
  rate_card_version int,
  scope jsonb not null default '[]'::jsonb,
  customer jsonb not null default '{}'::jsonb,
  crew jsonb not null default '{}'::jsonb,
  est_hours numeric,
  est_crew_hours numeric,
  est_man_hours numeric,
  resources jsonb not null default '[]'::jsonb,
  scheduling_class text not null default 'normal' check (scheduling_class in ('asap', 'priority', 'normal')),
  promised_window jsonb,
  depends_on text[] not null default '{}',
  status text not null default 'ready'
    check (status in ('ready', 'planned', 'scheduled', 'in_progress', 'done', 'cancelled')),
  planned_date date,
  scheduled_date date,
  crew_leader_id uuid references public.profiles(id) on delete set null,
  jobber_job_id text check (jobber_job_id is null or char_length(jobber_job_id) <= 200),
  jobber_job_number text check (jobber_job_number is null or char_length(jobber_job_number) <= 40),
  bid_request_id uuid,
  tasks jsonb not null default '[]'::jsonb,
  actuals jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_packets_one_per_package unique (estimate_id, package_key),
  constraint production_packets_shapes check (
    jsonb_typeof(scope) = 'array' and jsonb_typeof(customer) = 'object' and jsonb_typeof(crew) = 'object'
    and jsonb_typeof(resources) = 'array' and jsonb_typeof(tasks) = 'array'
    and (actuals is null or jsonb_typeof(actuals) = 'object')),
  constraint production_packets_sizes check (
    octet_length(scope::text) <= 200000 and octet_length(customer::text) <= 10000
    and octet_length(crew::text) <= 10000 and octet_length(resources::text) <= 20000
    and octet_length(tasks::text) <= 100000 and coalesce(octet_length(actuals::text), 0) <= 50000
    and coalesce(octet_length(promised_window::text), 0) <= 2000 and cardinality(depends_on) <= 20)
);
create index if not exists production_packets_company on public.production_packets (contractor_id, status, scheduled_date);
create index if not exists production_packets_leader on public.production_packets (crew_leader_id) where crew_leader_id is not null;
create index if not exists production_packets_jobber_job on public.production_packets (jobber_job_id) where jobber_job_id is not null;

create or replace function public.production_row_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.contractor_id := old.contractor_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists production_estimate_costs_touch on public.production_estimate_costs;
create trigger production_estimate_costs_touch before update on public.production_estimate_costs
  for each row execute function public.production_row_touch();
drop trigger if exists production_packets_touch on public.production_packets;
create trigger production_packets_touch before update on public.production_packets
  for each row execute function public.production_row_touch();

-- ---------------------------------------------------------------------------
-- 7. Who may do what
-- ---------------------------------------------------------------------------
-- The caller holds a permission key for this company: the owner, or an active employee row with the key (as in 0048).
create or replace function public.production_has_key(p_owner uuid, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_owner is not null and auth.uid() is not null
    and public.company_has_permission(p_owner, p_key)
    and (auth.uid() = p_owner or exists (
      select 1 from public.team_member_access m
      where m.owner_id = p_owner and m.user_id = auth.uid() and m.status = 'active'
        and m.member_kind = 'employee' and m.permissions -> p_key = 'true'::jsonb)), false);
$$;

create or replace function public.production_can(p_owner uuid, p_layer text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_owner is not null and auth.uid() is not null and (
    (public.is_admin() and p_layer in ('price', 'setup', 'dispatch', 'field', 'costs'))
    or case p_layer
      when 'price' then public.production_has_key(p_owner, 'createScout') or public.production_has_key(p_owner, 'reviewEstimates')
      when 'setup' then public.production_has_key(p_owner, 'operationalSettings')
      when 'dispatch' then public.production_has_key(p_owner, 'manageJobsSubs')
      when 'field' then public.production_has_key(p_owner, 'assignedJobs')
      when 'costs' then (auth.uid() = p_owner and public.company_has_permission(p_owner, 'operationalSettings'))
        or (auth.uid() = any(coalesce((select s.cost_viewer_ids from public.production_settings s
                                       where s.contractor_id = p_owner), '{}'::uuid[]))
            and (public.production_has_key(p_owner, 'createScout') or public.production_has_key(p_owner, 'reviewEstimates')
                 or public.production_has_key(p_owner, 'operationalSettings') or public.production_has_key(p_owner, 'manageJobsSubs')))
      else false end), false);
$$;

-- Mark's cost tables stay open as today unless the company started the large-company setup.
create or replace function public.production_costs_open(p_owner uuid, p_write boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.production_settings s where s.contractor_id = p_owner)
    or (public.production_can(p_owner, 'costs') and (not p_write or public.production_can(p_owner, 'setup')));
$$;

-- What the app may show the caller. Any failure on the app side means everything is off.
create or replace function public.production_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_live boolean;
  v_tests uuid[];
  v_extras boolean;
  v_model text;
  v_rollout boolean;
  v_eligible boolean;
  v_started boolean;
  v_published boolean;
begin
  if v_uid is null then
    return jsonb_build_object('rollout', false, 'eligible', false, 'published', false);
  end if;
  v_owner := coalesce(public.get_parent_contractor_id(v_uid), v_uid);
  select r.live, r.test_owner_ids, r.jobber_extras into v_live, v_tests, v_extras
    from public.production_rollout r where r.id = 1;
  v_rollout := coalesce(v_live, false) or v_owner = any(coalesce(v_tests, '{}'::uuid[]));
  select s.operating_model into v_model from public.company_settings s where s.contractor_id = v_owner;
  v_eligible := v_rollout and coalesce(v_model, 'subcontractors') in ('employees', 'hybrid');
  v_started := exists (select 1 from public.production_settings s where s.contractor_id = v_owner);
  v_published := v_eligible and exists (
    select 1 from public.production_rate_cards c
    where c.contractor_id = v_owner and c.status = 'published' and c.effective_from <= current_date);
  return jsonb_build_object(
    'rollout', v_rollout,
    'eligible', v_eligible,
    'started', v_started,
    'published', v_published,
    'owner', v_owner,
    'is_owner', v_uid = v_owner,
    'operating_model', coalesce(v_model, 'subcontractors'),
    'jobber_extras', v_eligible and coalesce(v_extras, false),
    'can', jsonb_build_object(
      'price', public.production_can(v_owner, 'price'),
      'setup', public.production_can(v_owner, 'setup'),
      'dispatch', public.production_can(v_owner, 'dispatch'),
      'field', public.production_can(v_owner, 'field'),
      'costs', case when v_started then public.production_can(v_owner, 'costs') else true end));
end $$;

revoke execute on function public.production_has_key(uuid, text) from public, anon;
revoke execute on function public.production_can(uuid, text) from public, anon;
revoke execute on function public.production_costs_open(uuid, boolean) from public, anon;
revoke execute on function public.production_status() from public, anon;
grant execute on function public.production_has_key(uuid, text) to authenticated, service_role;
grant execute on function public.production_can(uuid, text) to authenticated, service_role;
grant execute on function public.production_costs_open(uuid, boolean) to authenticated, service_role;
grant execute on function public.production_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Access rules on the new tables
-- ---------------------------------------------------------------------------
alter table public.production_settings enable row level security;
alter table public.production_rate_cards enable row level security;
alter table public.production_estimates enable row level security;
alter table public.production_estimate_costs enable row level security;
alter table public.production_packets enable row level security;

revoke all on public.production_settings, public.production_rate_cards, public.production_estimates,
  public.production_estimate_costs, public.production_packets from public, anon, authenticated;
grant select, insert, update on public.production_settings to authenticated;
grant select, insert, update, delete on public.production_rate_cards to authenticated;
grant select on public.production_estimates, public.production_estimate_costs, public.production_packets to authenticated;
grant all on public.production_settings, public.production_rate_cards, public.production_estimates,
  public.production_estimate_costs, public.production_packets to service_role;

drop policy if exists "Production settings read" on public.production_settings;
create policy "Production settings read" on public.production_settings for select to authenticated
  using (public.production_can(contractor_id, 'price') or public.production_can(contractor_id, 'setup')
         or public.production_can(contractor_id, 'dispatch'));
drop policy if exists "Production settings add" on public.production_settings;
create policy "Production settings add" on public.production_settings for insert to authenticated
  with check (public.production_can(contractor_id, 'setup'));
drop policy if exists "Production settings change" on public.production_settings;
create policy "Production settings change" on public.production_settings for update to authenticated
  using (public.production_can(contractor_id, 'setup')) with check (public.production_can(contractor_id, 'setup'));

drop policy if exists "Production rate cards read" on public.production_rate_cards;
create policy "Production rate cards read" on public.production_rate_cards for select to authenticated
  using (public.production_can(contractor_id, 'price') or public.production_can(contractor_id, 'setup'));
drop policy if exists "Production rate card drafts add" on public.production_rate_cards;
create policy "Production rate card drafts add" on public.production_rate_cards for insert to authenticated
  with check (status = 'draft' and public.production_can(contractor_id, 'setup'));
drop policy if exists "Production rate card drafts change" on public.production_rate_cards;
create policy "Production rate card drafts change" on public.production_rate_cards for update to authenticated
  using (status = 'draft' and public.production_can(contractor_id, 'setup'))
  with check (status = 'draft' and public.production_can(contractor_id, 'setup'));
drop policy if exists "Production rate card drafts remove" on public.production_rate_cards;
create policy "Production rate card drafts remove" on public.production_rate_cards for delete to authenticated
  using (status = 'draft' and public.production_can(contractor_id, 'setup'));

drop policy if exists "Production estimates read" on public.production_estimates;
create policy "Production estimates read" on public.production_estimates for select to authenticated
  using (public.production_can(contractor_id, 'price'));

drop policy if exists "Production costs read" on public.production_estimate_costs;
create policy "Production costs read" on public.production_estimate_costs for select to authenticated
  using (public.production_can(contractor_id, 'costs'));

drop policy if exists "Production packets read" on public.production_packets;
create policy "Production packets read" on public.production_packets for select to authenticated
  using (public.production_can(contractor_id, 'price') or public.production_can(contractor_id, 'dispatch')
         or (crew_leader_id = auth.uid() and public.production_can(contractor_id, 'field')));

-- ---------------------------------------------------------------------------
-- 9. Mark's cost tables: cost layer only once a company starts the setup
-- ---------------------------------------------------------------------------
alter table public.production_equipment add column if not exists unit text not null default 'hour';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'production_equipment_unit_check'
                 and conrelid = 'public.production_equipment'::regclass) then
    alter table public.production_equipment add constraint production_equipment_unit_check
      check (unit in ('hour', 'each', 'job'));
  end if;
end $$;

drop policy if exists "Production costs layer read" on public.production_labor_roles;
create policy "Production costs layer read" on public.production_labor_roles as restrictive for select to authenticated
  using (public.production_costs_open(contractor_id, false));
drop policy if exists "Production costs layer add" on public.production_labor_roles;
create policy "Production costs layer add" on public.production_labor_roles as restrictive for insert to authenticated
  with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer change" on public.production_labor_roles;
create policy "Production costs layer change" on public.production_labor_roles as restrictive for update to authenticated
  using (public.production_costs_open(contractor_id, true)) with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer remove" on public.production_labor_roles;
create policy "Production costs layer remove" on public.production_labor_roles as restrictive for delete to authenticated
  using (public.production_costs_open(contractor_id, true));

drop policy if exists "Production costs layer read" on public.production_equipment;
create policy "Production costs layer read" on public.production_equipment as restrictive for select to authenticated
  using (public.production_costs_open(contractor_id, false));
drop policy if exists "Production costs layer add" on public.production_equipment;
create policy "Production costs layer add" on public.production_equipment as restrictive for insert to authenticated
  with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer change" on public.production_equipment;
create policy "Production costs layer change" on public.production_equipment as restrictive for update to authenticated
  using (public.production_costs_open(contractor_id, true)) with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer remove" on public.production_equipment;
create policy "Production costs layer remove" on public.production_equipment as restrictive for delete to authenticated
  using (public.production_costs_open(contractor_id, true));

drop policy if exists "Production costs layer read" on public.production_pricing;
create policy "Production costs layer read" on public.production_pricing as restrictive for select to authenticated
  using (public.production_costs_open(contractor_id, false));
drop policy if exists "Production costs layer add" on public.production_pricing;
create policy "Production costs layer add" on public.production_pricing as restrictive for insert to authenticated
  with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer change" on public.production_pricing;
create policy "Production costs layer change" on public.production_pricing as restrictive for update to authenticated
  using (public.production_costs_open(contractor_id, true)) with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer remove" on public.production_pricing;
create policy "Production costs layer remove" on public.production_pricing as restrictive for delete to authenticated
  using (public.production_costs_open(contractor_id, true));

drop policy if exists "Production costs layer read" on public.production_plans;
create policy "Production costs layer read" on public.production_plans as restrictive for select to authenticated
  using (public.production_costs_open(contractor_id, false));
drop policy if exists "Production costs layer add" on public.production_plans;
create policy "Production costs layer add" on public.production_plans as restrictive for insert to authenticated
  with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer change" on public.production_plans;
create policy "Production costs layer change" on public.production_plans as restrictive for update to authenticated
  using (public.production_costs_open(contractor_id, true)) with check (public.production_costs_open(contractor_id, true));

drop policy if exists "Production costs layer read" on public.production_pricing_history;
create policy "Production costs layer read" on public.production_pricing_history as restrictive for select to authenticated
  using (public.production_costs_open(contractor_id, false));
drop policy if exists "Production costs layer add" on public.production_pricing_history;
create policy "Production costs layer add" on public.production_pricing_history as restrictive for insert to authenticated
  with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer change" on public.production_pricing_history;
create policy "Production costs layer change" on public.production_pricing_history as restrictive for update to authenticated
  using (public.production_costs_open(contractor_id, true)) with check (public.production_costs_open(contractor_id, true));
drop policy if exists "Production costs layer remove" on public.production_pricing_history;
create policy "Production costs layer remove" on public.production_pricing_history as restrictive for delete to authenticated
  using (public.production_costs_open(contractor_id, true));
