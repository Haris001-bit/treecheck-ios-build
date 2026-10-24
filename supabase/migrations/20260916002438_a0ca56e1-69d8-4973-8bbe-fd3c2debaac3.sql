REVOKE EXECUTE ON FUNCTION public.owns_crew_member(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_bid_request_owner(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_crew_recipient(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.refresh_crew_rating() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.owns_crew_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_bid_request_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_crew_recipient(uuid) TO authenticated, service_role;
