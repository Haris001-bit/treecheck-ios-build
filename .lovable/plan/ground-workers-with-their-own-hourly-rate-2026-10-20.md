# Ground workers with their own hourly rate

## What changes for you
- On each ground worker in **Subs**, a new field: **"Their hourly rate"**, blank means the standard $25/hr. You can type in a rate like $35.
- The worker can also enter their own rate in their profile. Next to that field they'll see: "Our standard pay is $25/hr. If your rate is higher, you'll still get job alerts, but only after the $25/hr crew has had a chance to claim the job."
- Your Subs list shows a small "$35/hr" tag on anyone above standard.

## How job alerts work
```text
1. Call-out opens  -> text/push only the ground workers at the standard rate (favorites first, as today)
2. Wait period     -> same first-pick window you already use (default 60 minutes)
3. Spots still open -> text/push the higher-rate workers
4. All spots filled -> higher-rate workers are never texted
```
- If everyone on your list is above standard, they all get the alert right away so the job isn't stuck.
- A higher-rate worker who claims a job is paid their own rate, and the 4-hour minimum still applies (4 x $35 = $140). The Monday pay summary and Pay page use that rate.
- When you set a day rate on a call-out, that day rate still wins, same as today.

## Technical details
- Add a nullable `hourly_rate` column to `crew_members` (owner-editable, per company) and `crew_profiles.hourly_rate` (the worker's own number; it's copied onto new company links). The owner's value wins over the worker's value. Validate 0–200 through `src/lib/inputLimits.ts`.
- `job-dispatch-open`: split recipients into standard (rate empty or ≤ 25) and premium. Premium workers go into the existing held group using `first_refusal_until`. `crew-release-holds` already texts the held group on release, so it only needs a check that skips the dispatch when every slot is already claimed.
- `groundPay` in `src/lib/payroll.ts` and `ground-hours-submit` use the worker's rate when the call-out has no rate. Add tests: $35 x 4h minimum = $140, standard stays $100, and a day rate overrides.
- UI: rate field in the sub edit dialog (`useCrew`/Subs), a field in the crew Profile page with the $25 notice, and the rate tag in the list.
