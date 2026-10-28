# Project architecture rules

- Subdirectories (supabase/functions/, supabase/functions/_shared/pulse/, src/components/pulse/, src/lib/production/, src/lib/pricing/) have their own AGENTS.md; read it before changing files there.
- Signup chooses audience first; DashboardLanding, DashboardLayout and Home wait for audience resolution before mounting company content. Office teams keep Home even with crew memberships; subcontractors redirect to crew jobs, preventing dashboard flashes.
- Sub exposure uses active non-sandbox companies within 30 miles to measure local availability.
- Serious signup, payment and uncaught errors use the shared recorder with 15-minute fingerprint dedup to avoid alert floods.
- Admin-only signup sandbox sessions never create real charges or notifications.
- Team invitations never change an existing account's password or team; an existing login accepts while signed in as the invited email, so an invite link never hands over another person's account.
- Lovable never reads Financial Pulse data (plaid_*, pulse_*, jobber_jobs, jobber_visit_revenue, jobber_payments): no queries, exports or row edits from chat or SQL tools, and nothing from them sent to any AI, because Plaid forbids sharing bank data with third parties. App screens showing an owner their own Pulse numbers are fine.
- Financial Pulse code (src/pages/Pulse*, src/components/pulse/, src/hooks/pulse/, src/lib/pulse/, supabase/functions/_shared/{pulse/,jobber.ts,plaid.ts,pulseHttp.ts}, supabase/functions/{plaid-*,pulse-*,jobber-revenue-sync}, docs/pulse/) can be changed whenever Mark asks; it is TreeCheck's own code.
- Never add RLS policies to, or grant anon/authenticated access on, plaid_item_secrets, plaid_slot_ledger, jobber_sync_state or pulse_events; their "RLS enabled, no policy" warning is intentional because they hold bank access keys for server functions only.
- public.pulse_owner_id() is SECURITY DEFINER and executable by authenticated on purpose; other Pulse/Jobber SQL functions are service_role only on purpose. Never change their grants for a security scan, because that breaks Pulse or exposes server-only operations.
- Multi-tree jobs (`trees` + `photo_paths`) are Pruning/Trimming only, because pruning prices come from climber bids, not the per-tree AI estimate.
- On iOS, subcontractors join by owner invite and never see pricing or purchase paths; in the phone apps (isNativeStoreBilling: iPhone and Android) no screen shows a Stripe price, checkout or billing link (wrap new ones in !isNativeStoreBilling()), because Apple rejects non-IAP purchase paths (3.1.1) and Google Play requires its own billing; the company plans sell there only through RevenueCat (/plan).
- User-facing links default to app.treecheck.ai, never lovable.app, because the brand must not show Lovable.
- Jobber switches in company_jobber_settings change only in the SQL editor by Haris, because each starts live Jobber writes or texts.
- Never add price columns to bid_requests (prices live in bid_request_quotes), because invited subs can read every bid_requests column.
- crm_interest_alerts has RLS on and no policies on purpose (only the crm-interest-alert function writes it); never add a policy or browser access, because it limits Mark to one text per company and CRM when an owner picks a CRM other than Jobber.
- jobber_connect_limit, jobber_connect_attempts and jobber_waitlist have RLS on and no policies on purpose, jobber_claim_connect() is service_role only, and the settings change only in the SQL editor by Haris (JC1), because until Jobber approves the app a sixth paying Jobber account cuts off Jobber for every company.
- Jobs list ordering must not depend on unread activity; reserve photo height before loading and avoid animated auto-scroll, because live updates and photo loads must not move the reader's place.
- Home uses route-local tokens; ad samples use labeled fictional values, never live widgets.
- Settings Admin links to the existing gated Pay route; office teams enter Admin without owner setup tabs.
- Subs history uses completed awarded bids, hired dispatches and owner-marked outside work; rating counts omit unrated jobs.
- Versioned billing uses separate protected tables, and every Stripe call follows the key's mode (companyPriceIds, rows matched on environment); the new plans open only through the billing_rollout switch, and legacy/native purchases stay separate to prevent repricing.
- Crew-only accounts stay on the pages in src/lib/crewPaths.ts; DashboardLayout sends other dashboard addresses to Jobs to Bid, so typed owner URLs never open company tools.
- Owner-typed costs, margins and calibration numbers go through src/lib/inputLimits.ts, because negative or absurd values were saved and priced.
- Catch expected refusals (no free seat, no card on file) and show the function's message, because the global error reporter texts TreeCheck's admin for every uncaught error.
- The large-company setup (production_* tables from PS1, the production-* functions, the new modules in src/lib/production and their generated copy in supabase/functions/_shared/production) is maintained outside Lovable; it shows only where production_status() allows it (production_rollout plus an employees or hybrid company), production packets never hold a price, and internal costs show only to the owner and the cost viewers the owner picked, because crew leaders read packets and margins are private.
<!-- LOVABLE:BEGIN -->
- DMA setup is company-scoped and written through dma-setup, separately from login email and website routing; connected status follows the existing publisher's tenant configuration rather than subscription status, because a paid customer may still need emailed content.
- Non-website DMA content is generated and edited through dma-email-content and saved in dma_email_posts; email sends stay unavailable until verified sender infrastructure exists, because drafts must never be reported as delivered.
<!-- LOVABLE:END -->
- Signup consent is recorded only by the signup functions into communication_consents (append-only, service-role writes) using the server copy of the wording in supabase/functions/_shared/consent.ts, kept identical to src/lib/consent.ts; marketing consent stays optional and unchecked, because US texting law forbids making it a condition of signing up.
- The Office team list loads through public.team_directory() (owner's own teammates, contact fields only), because profiles RLS lets users read only their own row; never widen profiles RLS for it.
