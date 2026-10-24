create or replace function public.crew_scout_notes()
returns table(bid_request_id uuid, notes text, difficulty text, risk text)
language sql
stable
security definer
set search_path = public
as $$
  select br.id,
         coalesce(sc.final_notes, sc.ai_notes),
         sc.ai_difficulty,
         sc.ai_risk
  from public.bid_requests br
  join public.scout_captures sc on sc.id = br.capture_id
  where public.is_crew_recipient(br.id)
    and coalesce(sc.final_notes, sc.ai_notes) is not null
$$;

grant execute on function public.crew_scout_notes() to authenticated;