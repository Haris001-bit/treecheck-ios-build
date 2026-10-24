# Simplify the main menu

## New menu (company accounts)

```text
Dashboard   (renamed from Home; same screen)
Jobs
Scout™
Marketing
Pulse
Subs
──────────────  (divider line)
Settings
Sign Out
```

Subcontractor menus (Jobs to Bid, My Availability, My Hours, Profile) stay as they are.

## Leads: hidden, not removed
- Leads leaves the menu, but every Leads screen (Available, Purchased, Service Areas, Premium), purchases, alerts and admin lead tools keep working untouched.
- One on/off switch in the code ("show Leads in menu", off for now). Turning it on later puts Leads back in the menu with no other work.
- Anyone with a saved Leads link can still open it.

## Settings becomes the home for admin items
Settings tabs become: Setup checklist, Pricing rates, How we work, **Integrations**, **Profile**, Admin.
- Integrations tab opens the existing Jobber connection screen.
- Profile tab opens the existing Profile screen.
- Office team members still see only the tabs they see today, plus Integrations and Profile.
- The Settings menu item stays highlighted while on any of these tabs.

## Technical details
- `DashboardLayout.tsx`: drop Integrations, Profile and Leads items from the company menu; add a `SHOW_LEADS_IN_MENU = false` flag; render a separator before Settings; mark Settings active for /dashboard/integrations/*, /dashboard/profile, /dashboard/pay.
- `HubTabs.tsx`: add Integrations (`/dashboard/integrations/jobber`) and Profile (`/dashboard/profile`) to the Settings group so those pages show the Settings tabs.
- Routes in `App.tsx` unchanged. Verify with Playwright signed in, plus existing audience tests.
