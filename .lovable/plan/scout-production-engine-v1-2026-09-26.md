# Scout Production Engine V1

Add-on only. Timber and any "Primarily subcontractors" company see no change.

## What you'll get
1. **Company Setup question**: "How does your company normally perform tree work?" (Subcontractors / Employees / Both). Timber and existing companies are set to Subcontractors automatically.
2. **Settings → Production Costs** (employee and hybrid companies only):
   - Labor roles with Loaded Hourly Cost (starts with Crew Lead, Climber, Ground Worker, Bucket Operator; add/remove your own).
   - Equipment with hourly cost (Chipper, Mini Skid, Bucket Truck, Chip Truck, Stump Grinder, Crane, Other).
   - Target Margin (default 30%), optional Minimum Job Charge, optional disposal cost per load.
3. **Scout Production Plan card** on the job screen (employee/hybrid only, tree removal):
   - Customer AI Ballpark shown at top.
   - Scout's suggested method, crew (role x count x hours), duration, person-hours, equipment, and a short "Scout considered" list (DBH, height, rigging, crane, loads, access notes).
   - "Adjust Production Plan" makes everything editable; cost updates live.
   - Expected Production Cost (labor / equipment / disposal), gross profit, margin, and Recommended Price = cost / (1 - margin), with minimum charge applied.
   - Status badge: Within / Below / Above Customer Ballpark.
   - Final Price: "Use Recommended" or enter a different price, with live profit and margin. Low margins are allowed.
   - Nothing is sent to the customer automatically.
4. **Learning data kept**: Scout's original plan is saved once and never overwritten; your adjusted plan, cost, recommended price, and final price are saved separately. Space is reserved for actual hours, crew, equipment, cost, and won/lost later.

## Hybrid companies
Employee plan by default; the existing "send to subs" flow stays available on the same job.

## Not in V1
Scheduling, payroll, overhead, ML, and any changes to the n8n prompt or the customer ballpark.

## Technical details
- `company_settings.operating_model` text default `'subcontractors'` (existing rows backfilled to that).
- New tables with RLS scoped to the owner or team (`get_parent_contractor_id`) plus grants: `production_labor_roles`, `production_equipment`, `production_pricing` (margin, min charge, disposal/load), `production_plans` (capture_id, original_plan jsonb, adjusted_plan jsonb, expected_cost, recommended_price, final_price, ballpark min/max snapshot, actual_* nullable, outcome nullable).
- **Centralized engine**: `src/lib/production/engine.ts` is a pure, deterministic module with typed inputs (`JobCharacteristics`, `CompanyCostConfig`) and outputs (`ProductionPlan`, `CostBreakdown`, `PriceRecommendation`). No UI code, no database calls, and an `ENGINE_VERSION` string saved with every plan. Every screen calls only this module, so it can later move into a backend function without changes.
- **Predicts from tree characteristics, not climber input**: crew, hours, and method come from DBH, height, canopy/leaders, condition, structure proximity, access, drop zone, power lines, loads, crane indicator, tree count, and stump. The climber/sub fields (`wk_ground_crew`, `wk_hours`) are never used. Other `wk_*` values (rigging, crane, loads) count only as secondary hints, flagged as such in the assumptions.
- **Confidence and assumptions**: each input is tracked as known, inferred, or missing. When a value is missing, the engine uses a conservative assumption, adds a line like "DBH unknown - assumed 24 in", and lowers confidence. Confidence (high/medium/low) comes from which key inputs are missing (DBH, height, access, rigging/drop zone). Low confidence shows a "Review recommended" banner, and the ballpark status also says "Review recommended". Confidence and assumptions are saved with the original plan.
- The card renders in the Jobs view only when operating_model is not 'subcontractors'; the subcontractor bid/award/Jobber code is not touched.
- Unit tests cover the margin math, the minimum charge, confidence levels when inputs are missing, and a check that the sub fields have no effect on the output.
