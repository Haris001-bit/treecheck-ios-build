CREATE POLICY "Company members read billing access summary" ON public.company_billing FOR SELECT TO authenticated USING(public.is_team_member_of(owner_id));
