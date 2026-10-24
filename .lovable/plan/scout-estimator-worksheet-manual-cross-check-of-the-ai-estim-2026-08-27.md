# Scout: Estimator Worksheet (manual cross-check of the AI estimate)

Give Scout a second way to price a job: the estimator answers a short set of production questions, the app prices them against the company's own saved rates, and the owner sees that number side by side with the AI estimate before choosing the final price.

## How it works for the user

**1. One-time setup — Scout Rates (owner only)**

A new Scout Rates section in settings where the owner enters their own numbers once:

- Climber hourly rate, ground crew hourly rate
- Crane hourly rate (plus optional crane mobilization/minimum fee)
- Rigging uplift: none / intermediate / advanced (percent or flat add for each)
- Disposal cost per load
- Stump grinding: base price + inches included (e.g. $250 up to 12 in) and per-inch rate after that
- Optional overhead/profit markup and a minimum job price

Defaults are pre-filled with sensible values so a new company can use it immediately.

**2. On the capture — Worksheet (field rep)**

Under the photo/notes on the Scout capture form, an optional collapsible "Estimator worksheet" panel:

- Climber required? (yes/no)
- Rigging level: none / intermediate / advanced
- Number of ground crew
- Estimated hours on site
- Estimated disposal loads
- Stump grinding? (yes/no) + stump diameter in inches
- Crane required? (yes/no) — when yes, an **estimated crane time (hours)** field appears and is priced at the saved crane hourly rate plus any mobilization fee
- Optional per-job extras line (e.g. permits, traffic control) with a dollar amount

Everything is optional — a rep who only wants the AI estimate can skip it entirely. As values are entered, a live "Your calculated price" total shows below the panel using the owner's saved rates.

**3. On review — side-by-side (owner)**

In Scout Inbox / Edit estimate, the capture shows two cards:

```text
   AI ESTIMATE              YOUR WORKSHEET
   $1,800 - $2,400          $2,150
   difficulty: high         6.5 hrs · climber · advanced rigging
                            2 crew · 2 loads · crane 3 hrs · stump 18"
        variance: worksheet is 6% below AI midpoint
```

The owner can edit any worksheet input right there and the total recalculates instantly. Two buttons — **Use AI price** and **Use worksheet price** — set the final price on the capture, then approval continues exactly as it does today (promote to lead, Jobber, SMS/email to the submitter). If no worksheet was filled in, the screen looks like it does today.

The worksheet breakdown is saved with the capture, so the final quote and the lead carry a record of how the price was built.

Applies to all three services (Tree Removal, Stump Grinding, Pruning/Trimming) — the crew/hours/loads inputs work for all of them; the stump section is what turns on for grinding.

## Technical notes

- New table `scout_rate_cards` — one row per account owner (`contractor_id` unique), holding the rate fields above. RLS: owner reads/writes their own; team members read their owner's card (via `get_parent_contractor_id`); grants for `authenticated` + `service_role`.
- New nullable columns on `scout_captures`: `wk_climber_required`, `wk_rigging_level`, `wk_ground_crew`, `wk_hours`, `wk_loads`, `wk_crane_required`, `wk_crane_hours`, `wk_stump`, `wk_stump_diameter_inches`, `wk_extras_amount`, `wk_extras_note`, `wk_total`, `wk_breakdown jsonb`, plus `price_source text` ('ai' | 'worksheet') set on approval.
- Pricing math lives in one shared module `src/lib/scoutWorksheet.ts` (pure function: inputs + rate card → total + itemized breakdown) so the capture form, the review screen, and any future server use share identical logic. No AI call is involved in the worksheet path.
- `submitScoutCapture` / `scout-submit` pass the worksheet fields through; `saveEditedCapture` and `approveCapture` in `src/lib/estimatorService.ts` accept the chosen `price_source` and write `final_price_min` / `final_price_max` from the selected source (worksheet total sets both min and max).
- New hook `useScoutRates` for reading/writing the rate card; new settings page `src/pages/ScoutRates.tsx` linked from the dashboard sidebar for owners only.
- UI additions: worksheet panel component reused in `InstantEstimator.tsx` and `ScoutEditEstimateDialog.tsx`; comparison card in `ScoutInbox.tsx`.
- No change to the n8n AI callback path — the AI estimate keeps arriving and storing exactly as it does now.
