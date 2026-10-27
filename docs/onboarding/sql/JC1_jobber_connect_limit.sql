-- JC1: TreeCheck stops at Jobber's limit until Jobber approves the TreeCheck AI app (App Improvements, 2026-10-26).
-- An app Jobber hasn't approved may connect at most 5 paying Jobber accounts (its test accounts don't count), and a
-- sixth cuts off Jobber for every company, Timber included. Mark, 2026-10-25: "we need to figure out a way to stop them
-- from trying to connect with Jobber". Reference SQL. Applied through Lovable (TreeCheck project) exactly as written.
-- Safe to apply twice: a second run changes nothing and never resets the settings.
--
-- * jobber_connect_limit: one settings row, changed only in the SQL editor.
--     max_accounts: the most paying Jobber accounts TreeCheck may hold (5). null switches the whole limit off, for when
--       Jobber approves the app.
--     open_to_all: false means only the companies in chosen_owner_ids may take a free place (Mark picks them). The first
--       run fills chosen_owner_ids with every company that has connected Jobber before.
--     test_owner_ids: TreeCheck's own test companies, which connect Jobber's test accounts. Jobber doesn't count those,
--       so they always may connect and use no place. The first run fills it with the sandbox companies that have
--       connected Jobber before.
-- * jobber_connect_attempts: a company handed a Jobber link holds a place for 30 minutes (how long the link works), so
--   two companies pressing Connect together can never both take the last place.
-- * jobber_waitlist: each company that pressed Connect Jobber when no place was theirs. They see Mark's message, and
--   jobber-connect texts and emails Mark once per company (it claims alerted_at before it sends).
-- * jobber_claim_connect(): the only way jobber-connect hands out a Jobber link. Under one lock it either records the
--   link (jobber_oauth_states) or puts the company on the waitlist. A company connected now always gets through, so
--   reconnecting never needs a free place.
-- No browser access to any of it: RLS on with no policies (the warnings are intentional), and the function runs only for
-- the service role.

create table if not exists public.jobber_connect_limit (
  id boolean primary key default true check (id),
  max_accounts integer check (max_accounts between 0 and 1000),
  open_to_all boolean not null default false,
  chosen_owner_ids uuid[] not null default '{}' check (array_position(chosen_owner_ids, null) is null),
  test_owner_ids uuid[] not null default '{}' check (array_position(test_owner_ids, null) is null)
);

insert into public.jobber_connect_limit (id, max_accounts, open_to_all, chosen_owner_ids, test_owner_ids)
select true, 5, false,
       coalesce(array_agg(t.contractor_id order by t.created_at) filter (where p.is_sandbox is not true), '{}'),
       coalesce(array_agg(t.contractor_id order by t.created_at) filter (where p.is_sandbox is true), '{}')
  from public.jobber_tokens t
  left join public.profiles p on p.id = t.contractor_id
on conflict (id) do nothing;

create table if not exists public.jobber_connect_attempts (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now()
);

create table if not exists public.jobber_waitlist (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_tried_at timestamptz not null default now(),
  alerted_at timestamptz
);

alter table public.jobber_connect_limit enable row level security;
alter table public.jobber_connect_attempts enable row level security;
alter table public.jobber_waitlist enable row level security;
revoke all on public.jobber_connect_limit, public.jobber_connect_attempts, public.jobber_waitlist
  from public, anon, authenticated;
grant select, insert, update, delete on public.jobber_connect_limit, public.jobber_connect_attempts, public.jobber_waitlist
  to service_role;

-- Lets a company start a Jobber connection, or puts it on the waitlist. Returns {"allowed": true} once the link's state is
-- recorded, or {"allowed": false, "used": n, "max": m} with the places in use.
create or replace function public.jobber_claim_connect(p_owner uuid, p_state text, p_return_to text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_open boolean;
  v_chosen uuid[];
  v_test uuid[];
  v_used integer;
begin
  if p_owner is null or coalesce(p_state, '') = '' then
    raise exception 'jobber_claim_connect needs an owner and a state';
  end if;
  -- One claim at a time, so two companies pressing Connect together can't both take the last place.
  perform pg_advisory_xact_lock(hashtext('public.jobber_claim_connect'));

  select l.max_accounts, l.open_to_all, l.chosen_owner_ids, l.test_owner_ids
    into v_max, v_open, v_chosen, v_test
    from public.jobber_connect_limit l
   where l.id;
  if not found then
    -- No settings row: the limit stays on at 5, and only companies connected now get through.
    v_max := 5;
    v_open := false;
    v_chosen := '{}';
    v_test := '{}';
  end if;

  if v_max is not null
     and not coalesce(p_owner = any (v_test), false)
     and not exists (select 1 from public.jobber_tokens t where t.contractor_id = p_owner and t.disconnected_at is null) then
    select count(*) into v_used
      from (
        select t.contractor_id as owner_id
          from public.jobber_tokens t
         where t.disconnected_at is null
           and not coalesce(t.contractor_id = any (v_test), false)
        union
        select a.owner_id
          from public.jobber_connect_attempts a
         where a.started_at > now() - interval '30 minutes'
           and a.owner_id <> p_owner
           and not coalesce(a.owner_id = any (v_test), false)
      ) holding;

    if v_used >= v_max or (not coalesce(v_open, false) and not coalesce(p_owner = any (v_chosen), false)) then
      insert into public.jobber_waitlist (owner_id) values (p_owner)
        on conflict (owner_id) do update set last_tried_at = now();
      return jsonb_build_object('allowed', false, 'used', v_used, 'max', v_max);
    end if;

    insert into public.jobber_connect_attempts (owner_id) values (p_owner)
      on conflict (owner_id) do update set started_at = now();
  end if;

  insert into public.jobber_oauth_states (state, contractor_id, return_to) values (p_state, p_owner, p_return_to);
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.jobber_claim_connect(uuid, text, text) from public, anon, authenticated;
grant execute on function public.jobber_claim_connect(uuid, text, text) to service_role;
