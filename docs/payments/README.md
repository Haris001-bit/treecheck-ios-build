# Payments: the company plans on the live Stripe key

Payments milestone, TreeCheck App Improvements, from 2026-10-21. Stripe runs on a restricted live key ("TreeCheck live")
with Write on Customers, Payment Intents, Payment Methods, Products, all of Billing and Checkout Sessions. It has no
Refunds and no webhook-endpoint permission, and it can't be read back, so every Stripe call runs in an edge function.

## The switch

`billing_rollout` (one row, PL1) is changed only in the SQL editor:

| Column | What it opens |
|---|---|
| `web_live` | The new plans on the website: plan choice and card at signup, the plan picker (`/dashboard/plans`), the banners and reminders |
| `test_owner_ids` | The same, for listed throwaway owners only, before `web_live` |
| `store_sandbox_owner_ids` | Who App Store and Google Play sandbox purchases may unlock (phone plans) |

The phone apps never show Stripe prices or checkout: the functions that start a Stripe charge refuse their requests
(`_shared/nativeClient.ts`).

## How a company pays

- **New web signup** (with `web_live`): the owner picks Core + 1 Scout or Core only, monthly or yearly. `create-trial-signup`
  opens a 2026-10 `live` row with no access yet. The app signs in, and company-billing's Checkout takes the card with the
  14-day trial (`trial_end`).
- **An owner on the no-card trial, or a free or locked owner:** "Choose a plan" calls company-billing `checkout`. It moves
  that one company to the 2026-10 plans first (`convertToPlans`), keeping a running trial's end date. It refuses Timber,
  founders, paid legacy customers, Apple subscribers and companies with teammates.
- **Trial end:** Stripe charges the card. With under 48 hours left at checkout, the trial moves to 49 hours out, because
  Stripe needs 48 (`checkoutTrialEnd`).
- **Failed renewal:** `past_due` keeps access for 7 days from the renewal date (`company_past_due_grace`), with a banner to
  update the card in Stripe's portal (company-billing `portal`).
- **Account deleted:** `delete-account` cancels the account's Stripe subscriptions before anything else.

## Messages (billing-reminders, daily)

No dashes in any text. Sandbox companies send nothing (`tcNotify`).

| Id | When | Channel | Text |
|---|---|---|---|
| B1 | A company-plan trial with a card, 7 days before it ends | Email | Subject: `Your TreeCheck trial ends on {date}`. Body: `Your free trial of TreeCheck ends on {date}. Your card will then be charged {amount} a {month/year}, and your plan carries on with nothing to do. If you'd rather not continue, cancel before then in TreeCheck under Profile, then Billing, and you won't be charged.` |
| B2 | A trial with no card, 2 days before it ends, once the plans are open | Email | Subject as B1. Body: `Your free trial of TreeCheck ends on {date}. To keep Scout, your jobs and your crews running after that, choose a plan: https://app.treecheck.ai/dashboard/plans` |
| B2 | Same | Text | `TreeCheck: your free trial ends {date}. Choose a plan to keep your account running: https://app.treecheck.ai/dashboard/plans` |

## SQL

| File | What it is |
|---|---|
| `sql/PL1_billing_live.sql` | The switch, the reminder log, and the past_due grace in `company_plan` and `company_has_permission` |
| `sql/checks/readback_PL1.sql` | Read-back; every column must be true |
| `sql/down/PL1_billing_live.down.sql` | Rollback |

PGlite test: `tools\pgtest\test-pl1.mjs` in the engagement folder.
