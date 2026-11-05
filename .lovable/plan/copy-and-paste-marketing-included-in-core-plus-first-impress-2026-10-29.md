# Copy-and-paste Marketing included in Core, plus First Impression awareness

## What changes for owners
1. **Core includes copy-and-paste Marketing.** Every Core plan (and Core + Scout) can make full copy-and-paste posts. No separate $99/month add-on any more. Prices stay the same: Core $79, Core + Scout $128.
2. **Sign-up page / plan screens.** The Core cards list "Marketing Agent: job posts written for you to copy into your website". The separate $99 Marketing box is replaced with: "Want posts published straight to your website from the job site? We build First Impression websites. Learn more." The phone apps show the same wording with no prices or links.
3. **Every copy-and-paste post carries a note** above the content: "This content can be published to your website automatically, straight from the job site, with a First Impression website. Learn more." The Learn more link opens the TradesMarketing.ai First Impression page, where the Schedule a demo button lives. (The phone apps show the note without the link.)
4. **The welcome box on Marketing** (added earlier) changes to match: Core owners go straight to making posts. Only Free plan owners still see the 3 sample posts.
5. **Knowing who has a First Impression website.** One switch per company, "First Impression website: yes/no", set by TreeCheck admins on the company's admin page (it already exists there as "Site provider: First Impression"). The app uses only that switch to decide:
   - Yes: Marketing shows the publish-to-website flow (what Timber uses today).
   - No: Marketing shows copy-and-paste posts with the First Impression note.
   The hard-coded list of Timber and test accounts gets replaced by this switch, with Timber's accounts switched on so nothing changes for you.

## Your part outside the app
- On the TradesMarketing.ai First Impression page (tradesmarketing.ai/dma-web), make sure the Schedule a demo button is there (https://calendly.com/hello-tradesmarketing/30min).

## Technical details
- `company_has_permission` (0051/0055) grants `dmaManage`/`dmaSubmit` only for trialing, complimentary or `dma_source in ('paid','website')`. A new migration extends it to any active 2026-10 Core plan. This is versioned billing SQL, so the migration goes to Haris for review before it's applied (no billing rows touched, no Stripe changes).
- `src/lib/pricing/catalog.ts`: Core features gain copy-and-paste DMA; `plan.dma === 'paid'` stops being offered for new choices. Existing $99 DMA subscribers keep being billed until they're moved; Haris decides whether to refund or cancel those (no automatic cancellations).
- `CompanyCatalog.tsx` and `StoreCatalog.tsx`: Core feature line plus the First Impression box (StoreCatalog stays price-free in the DMA section, as now).
- `DMAEmailPosts.tsx`: a fixed First Impression note above every post; the Learn more link is hidden when `isNativeStoreBilling()`.
- First Impression flag: `dma_integrations.site_provider = 'first_impression'` with a publish address becomes the only test in `connectedPublisher` (dma-setup/rules.ts) and in dma-publish-project's Timber/webhook check. Timber's 3 accounts get backfilled with the flag in the same migration. `company_billing.dma_source = 'website'` follows the same admin switch.
- Tests: Core owner `can_generate` true without a DMA add-on; Free owner still preview-only; a company without the flag is never treated as connected; the note shows on posts, and its link is hidden in the apps.
- The phone apps need a new build to show the new plan wording; website and server changes go live after publishing.
