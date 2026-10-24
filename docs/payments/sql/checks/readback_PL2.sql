-- Read-only check after applying PL2. One row; every column must be true. Reads only the database catalog.
select
  position('company_past_due_grace' in pg_get_functiondef('public.company_has_permission(uuid,text)'::regprocedure)) > 0 as keeps_pl1_grace,
  position('b.status=''incomplete''' in pg_get_functiondef('public.company_has_permission(uuid,text)'::regprocedure)) > 0 as setup_before_card,
  position('company_has_permission' in (select qual from pg_policies where tablename = 'company_settings' and policyname = 'Versioned settings permission')) > 0 as settings_policy_unchanged;
