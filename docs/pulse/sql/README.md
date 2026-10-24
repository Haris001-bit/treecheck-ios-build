# Financial Pulse reference SQL

Reviewed SQL for every database change in the Financial Pulse build. TreeCheck's backend runs on
Lovable Cloud, so these files are **not** applied by merging. Each one is applied by pasting a
prompt into the TreeCheck Lovable project that creates a migration containing exactly this SQL.
Compare the SQL in Lovable's approval dialog with the file before approving, then read the result
back with a SELECT.

Applying the same file twice in a row is safe. Re-applying an older file after a newer one puts back the
older version of every function the newer one replaced (for example M2 or M5 after M6 puts back a
`pulse_window_totals` without payments), and re-applying M6 moves companies set to `job_total` or
`as_jobber` back to the defaults. After any re-apply, run the read-backs in `checks/` and R1. `down/`
holds the rollback for each file.

| File | What it does | Status |
|---|---|---|
| `M1_hardening.sql` | Tightens the profiles INSERT policy (no self-made admins or free upgrades) | Applied 2026-09-29 (drizzle 0019) |
| `M2_pulse_core.sql` | Financial Pulse tables, owner-only access rules, sealed tables, server-only helper functions | Applied 2026-09-29 (drizzle 0020) |
| `M3_jobber.sql` | Jobber connection upgrade: Jobber account id per connection (one company per Jobber account), refresh lock, return address after connecting, per-visit amount for recurring jobs. Needs M2 | Applied 2026-09-29 (drizzle 0021) |
| `M4_plaid.sql` | Plaid connection guard and bank-token storage: `plaid_reserve_slot` (company and team limits, "this bank is already linked", under one lock; reservations expire after 10 minutes), an `exchanging` state that counts from the moment Plaid is called, `plaid_store_item` (connection, encrypted token and ledger saved in one transaction, safe to repeat), a recovery slot on the sealed ledger, `plaid_slots_used`, sorter write-back (`pulse_apply_classifications`), one sort per company at a time (classify lock), a re-sync request flag, and `plaid_accounts.count_from_confirmed_at`. Needs M2 | Applied 2026-09-30 (drizzle 0024) |
| `M5_pulse_numbers.sql` | Numbers for the Pulse screen: a `review` flag on each bank transaction (written by `pulse_apply_classifications`), payment counts per category, money out and money in kept apart for every "not counted" reason, and the flagged-for-review count and total in `pulse_window_totals` (every existing key unchanged), plus `pulse_account_starts` (each account's first transaction date). Needs M2 and M4 | Applied 2026-10-01 (drizzle 0027) |
| `M6_payment_revenue.sql` | Revenue on the day payment is received: payments recorded in Jobber (`jobber_payments`, owner-readable, written by the server only), revenue basis 'auto' (Joe's rule, the new default) and 'payments', no sales tax by default (companies on the old defaults move to the new ones), payments import progress and one payments read at a time per company, `pulse_revenue_basis`, and revenue from payments in `pulse_window_totals`, which also reports the basis it used (every other key unchanged). Needs M2 to M5 | Applied 2026-10-06 (drizzle 0032) |
| `M7_loan_payments.sql` | Loan payments are not costs (Joe Evans, 2026-10-06): `plaid_transactions.exclude_reason` gains `loan_payment` (sorter-6). Apply BEFORE deploying the sorter-6 functions. Needs M2 | Not applied yet |

`checks/readback_M1_M2.sql` is a read-only query to run after applying M1 and M2: every value under
`checks` must be `true`.
`checks/readback_M4.sql` does the same for M4 (and shows how many production bank connections are used).
`checks/readback_M5.sql` does the same for M5 (it reads only the database catalog, no finance rows).
`checks/readback_M6.sql` does the same for M6 (it also reads only the database catalog).
`checks/readback_M7.sql` does the same for M7 (it also reads only the database catalog).
`checks/readback_M3.sql` does the same for M3 (it also shows how many Jobber connections exist and how
many still lack an account id; no tokens are read).

`checks/realdata_checks.sql` is the real-data check pack for companies on real banks (milestone 2, tuning,
Joe's monthly totals). Every query is one read-only SELECT, run one at a time in the SQL editor. R1 to R10
return counts, totals, dates and states only and may be shared with Claude (R1, R6 and R10 need M6); H1 to H6
list real payments and payee names and are for Haris only, never pasted into any AI tool. Tested 2026-10-06 in
tools/pgtest (`test-checks.mjs`, 104 checks, including R10 and a check that the paste-ready copies in
tools/checks match the pack).

`scripts/pulse-isolation-check.mjs` (repo root) signs in with TreeCheck test logins and proves each one
sees only its own company's rows, using counts only.

Both files were tested on 2026-09-29 against Postgres 17 (PGlite) with Supabase's roles and default
privileges reproduced: 112 access, totals, idempotency and rollback checks passed, and the read-back
returned all true after the migrations and false before them.

M3 was tested on 2026-09-29 the same way (on top of M1 and M2): 22 checks passed (one live connection per
Jobber account, the refresh lock, server-only functions, revenue totals from job and visit rows, rollback),
and its read-back returned all true.

Read-backs tightened on 2026-09-29 after an adversarial review: they now also check the 11 owner access
rules exactly, all ten conditions of the profiles INSERT rule and that no other INSERT rule exists on profiles,
that browsers cannot insert, update or delete Jobber connections (RLS on), and that the Jobber account index is
unique over live connections. Nine deliberately broken states were each caught (tools/pgtest).

M4 was tested on 2026-09-30 the same way (on top of M1 to M3), then again after two adversarial reviews: 75 checks passed (the same bank refused under the lock, a connection mid-exchange counted and never expiring, the one-transaction save and its repeat, company and team limits, access checks, the sorting lock held by a token (a sort whose lock ran out never frees another sort's lock), the re-sync flag, browser lockout, write-back of only this company's changed rows, rollback refused while a connection is mid-exchange, rollback closing open reservations, rollback and re-apply). Its read-back returned all true after M4 and caught three tampered states.

M5 was tested on 2026-10-01 the same way (on top of M1 to M4): 89 checks passed (applied twice, with and without data; every pre-M5 key of `pulse_window_totals` identical to the M2 function's result in four windows and to a hand count; payment counts per category; a matched card payment shown as 1250 out and 1250 in instead of netting to 0; pending outflow and pending deposit kept apart; money in only for inflows; review counted only for posted costs; partial windows; another company's rows never counted; `pulse_account_starts` with pending rows included; write-back of `review`, where a missing `review` means false and a change of `review` alone counts as a change; browser lockout; rollback twice, restoring M2's and M4's functions word for word, then re-apply). Its read-back returned all false before M5, all true after, and caught ten tampered states.

M6 was tested on 2026-10-06 the same way (on top of M1 to M5): 85 checks passed (applied twice; companies on the old defaults moved to 'auto' and no sales tax, an explicit revenue basis kept; Joe's rule in `pulse_revenue_basis`, which waits for both first Jobber imports and leaves out deleted payments, payments older than 120 days and other companies' payments; revenue from payments in `pulse_window_totals` without tax and as Jobber shows it, every other key equal to M5's, and on the completed-jobs basis the same result as M5's apart from the basis it reports; owners read only their own payments and can't add, change or delete any, a team member and a signed-out browser read none; server-only functions; the payments lock; rollback twice, restoring M5's `pulse_window_totals` word for word, then re-apply twice). Its read-back was false before M6 for the payments table, the revenue settings and the totals, all true after, and caught seven tampered states.
