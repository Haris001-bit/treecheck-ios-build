-- Rollback for JC1. Deploy jobber-connect from before JC1 first: without jobber_claim_connect the JC1 version answers 500
-- and hands out no Jobber link, so nobody can connect (which never risks a sixth account). Safe to run twice. The
-- settings and the waitlist are lost: re-applying JC1 fills the chosen and test companies again from the companies that
-- have connected Jobber, and Mark may get a second text about a company already on the waitlist.

drop function if exists public.jobber_claim_connect(uuid, text, text);
drop table if exists public.jobber_waitlist;
drop table if exists public.jobber_connect_attempts;
drop table if exists public.jobber_connect_limit;
