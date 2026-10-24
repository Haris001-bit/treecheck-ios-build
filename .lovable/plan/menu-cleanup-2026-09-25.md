# Menu cleanup

## Current owner menu (17 items) and what each does

| Menu item | What it does | Overlap |
|---|---|---|
| Available Leads | Buy homeowner leads from the lead aggregator | Leads group |
| Your Leads | Leads you already bought (address, phone) | Leads group |
| Service Areas | Cities you buy leads in | Leads group |
| Go Premium | Upgrade for lead head start / auto-refill | Leads group |
| Marketing | $99/mo done-for-you Marketing Package sign-up form + profile | Marketing group |
| Google Reviews | Send review requests to customers | Also inside Digital Marketing Agent |
| Digital Marketing Agent | Jobsite photo + voice becomes a post on your site, Google, Facebook, Instagram; has its own Google review link | Marketing group |
| Start here | Setup checklist | Settings group |
| Scout | Capture a tree, get AI price | Jobs group |
| Jobs | Scout review + bid board + Jobber quote | Jobs group |
| Scout Rates | Your pricing rates for Scout | Settings group |
| My Subs | Your subcontractors + find subs near you | People group |
| Team | Office staff logins (LesLee) | People group |
| Integrations | Jobber connection | Settings group |
| How we work | Company setup answers | Settings group |
| Profile | Your account | Settings group |

"Available Leads / Your Leads" are aggregator leads you buy. "Jobs" are your own work (Scout, website, Jobber). They look alike but are different, which is why it feels confusing.

## New menu (8 items)

```text
Scout
Jobs
Leads          (Coming Soon)
Marketing
People
Integrations
Settings
Profile
```

1. **Leads — Coming Soon.** Replaces Available Leads, Your Leads, Service Areas, Go Premium. One page explaining: we send you homeowners who asked for tree work, how unlocking works (up to 3 companies per lead), "We're not in your area yet — tap to be notified when we launch." Old links redirect here. Admins and contractors in active lead cities (OKC, Austin, Testville) still see the real leads pages inside this item as tabs: Available, Purchased, Service Areas.
2. **Remove Google Reviews** from the menu. The review link stays inside Marketing.
3. **Marketing** combines Marketing and Digital Marketing Agent as tabs:
   - "Post your jobs" (the AI agent — do-it-yourself, included)
   - "Done for you" ($99/mo Marketing Package)
4. **People** combines Team and My Subs as tabs: "Office team" (logins like LesLee) and "Subcontractors" (your subs + find subs near you). They stay separate lists because office staff see prices and subs never do.
5. **Settings** combines Start here, Scout Rates and How we work as tabs: Setup checklist, Pricing rates, How we work.
6. Sub (crew) menu is unchanged: Jobs to Bid, My Availability, Profile.
7. Admin section unchanged.

## Lead intake stays exactly as it is
This is a menu-only change. Nothing that brings leads in is touched:
- Website leads, AI call handler leads and aggregator leads keep arriving through the webhook.
- Scout captures keep arriving and auto-sending to climbers.
- All of these keep landing in Jobs (Needs review / Active) as today.
- The "Coming Soon" Leads page only changes what customers see in the menu. It does not turn off or delete any leads.
- After the change, check that the webhook and Scout still create jobs, using a Testville, AL test lead.

## Technical details
- No edge functions, webhooks (create-lead, n8n, LSA/Retell) or lead tables are edited.
- `DashboardLayout.tsx`: rebuild owner nav list; keep product/feature gating per item.
- New wrapper pages with URL tabs (`?tab=`): `LeadsHub`, `MarketingHub` (embeds DMA + Marketing), `PeopleHub` (embeds Team + CrewNetwork), `SettingsHub` (embeds ScoutStart, ScoutRates, HowWeWork). Existing pages get an `embedded` prop to hide their own headers.
- `LeadsComingSoon` component; shown unless user is admin or has a service area in an active lead market. "Notify me" saves interest to the contractor profile.
- Redirects from old paths (`/dashboard/purchased`, `/service-areas`, `/pricing`, `/google-reviews`, `/dma`, `/team`, `/crew-network`, `/scout-rates`, `/how-we-work`, `/start`) to the matching hub tab so texts and bookmarks keep working. `/dashboard` home becomes Jobs for owners.
- No database or payment changes.
