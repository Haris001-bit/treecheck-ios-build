# Scout learning (the weekly feedback loop)

TreeCheck App Improvements, milestone 4. Each week, for each company that turns it on, the loop compares Scout's
own first estimate with the price the owner picked in Jobs (auto-picks count, marked "auto"), and an AI writes a
short per-company guidance block: capped price factors per job type and size, plus a few reading rules. The block
is sent to Scout (and, for Timber, the website estimator) with every estimate. Scout's shared prompt stays shared.

Maintained outside Lovable. Rules: `supabase/functions/AGENTS.md` (Scout learning line).

## Pieces

| Piece | What it does |
|---|---|
| `sql/SL1_scout_learning.sql` | The switches on `company_settings`, the sealed `estimate_snapshots` and `scout_learning_runs` tables, and `scout_learning_claim`, `_finish`, `_report`, `_undo` |
| `supabase/functions/_shared/scoutLearningCore.ts` | Pure helpers (inputs, sanitizing, limits) |
| `supabase/functions/_shared/scoutLearning.ts` | Guidance reads and snapshot writes; never throws, fails safe to no guidance |
| `scout-submit`, `scout-retry-estimate` | Send `company_guidance`, mark the callback `?src=scout`, record what Scout was given |
| `scout-estimate-callback` | Records Scout's first real answer (`src=scout` only, so a "Request edit" answer never counts) |
| `create-personal-lead` | `GET ?guidance=website` for the website estimator (same secret as a lead); records the website estimate; keeps the learning fields out of the stump scan |
| `supabase/functions/_shared/scoutLearningWeekly.ts` | Pure: weeks (America/Chicago), comparisons and exclusions, the agent's job description and schema, `checkAnswer` (clamps), `renderBlock` |
| `supabase/functions/_shared/scoutLearningRun.ts` | The tick: previews, first runs, weekly runs; the Lovable AI Gateway call |
| `scout-learning-run` | Service key only; replies at once and runs one tick after replying. Started by `crew-release-holds` on scheduled runs |
| Scout screen card (PR C) | The switch, last week's report, undo |

## Switches

- `company_settings.scout_learning_enabled`: the owner's switch (off by default).
- `company_settings.scout_learning_website`: the website side, set only by Haris in the SQL editor.
- Secret `TC_SCOUT_LEARNING_KILL=1`: every company gets standard Scout at once, no redeploy.

## Go-live for PR A (data only; nothing users see changes)

1. Lovable applies `sql/SL1_scout_learning.sql` exactly, as the next drizzle migration.
2. Haris runs `sql/checks/readback_SL1.sql`: every column true.
3. Lovable deploys exactly `scout-estimate-callback`, `scout-submit`, `scout-retry-estimate`, `create-personal-lead`.
4. One Scout capture on the sandbox demo company: its snapshot has inputs and a result.

Preview before go-live (writes nothing that goes live): in the SQL editor run
`select public.scout_learning_request_preview('<company owner id>', 'scout');` and, within about 10 minutes,
`select status, summary, changes, guidance, block, jobs from public.scout_learning_runs where kind = 'preview' order by claimed_at desc limit 1;`

Rollback: `sql/down/SL1_scout_learning.down.sql`. PGlite test: `tools\pgtest\test-sl1.mjs` in the engagement folder.

## How a run decides (PR B)

- **When:** a company's first run within about 10 minutes of the owner turning learning on (past 26 weeks, up to 40 jobs); then the
  Monday to Sunday week's run from Monday 07:00 America/Chicago, with catch-up. The first run's own week is never re-run.
- **Jobs that count:** a pick on the job (auto-picks count, marked auto), not Testville, not a Free preview, not pruning, an estimate
  above 0 (Scout's first answer from the snapshot, else the capture's columns, flagged "may include an owner edit"). A weekly run uses
  jobs picked before the week ended, within 8 weeks, not used by an earlier finished run, and shows the agent earlier jobs as context.
- **No new jobs:** `no_jobs`, no AI call, guidance unchanged.
- **The agent** (`openai/gpt-6-astra`, strict schema, nothing stored) proposes factors and rules; `checkAnswer` clamps factors to
  0.60 to 1.40 (a weekly run moves one at most 0.15), drops rules with money, percentages, multipliers, links or instructions, and
  refuses summaries with personal details. Customer names, addresses, phones and emails never reach the agent.
- **Large misses** (Mark, 2026-10-27): every new job 15% or more above or below its pick (as the card rounds it) gets the agent's
  likely reason, cause type and confidence, shown as "Why Scout missed" when the owner opens the job. `missesOf` keeps one only when
  it fits that job (direction and gap) and holds no contact details, links or job ids. Explanations never change the guidance and
  never fail a run. A latest report finished before this gets its large misses explained once, on a tick with no other AI call.
- **Failures** (credits, busy, timeout, refused answer) finish as `failed`; the guidance stays; up to 3 attempts.
- **One AI call per tick** at most.
