// Scout learning's weekly run, the database and AI part (called by the scout-learning-run function). Server-side
// only. Maintained outside Lovable.
//
// Each tick (every 10 minutes, from crew-release-holds) does at most one AI call: a preview Haris asked for, a
// company's first run after it turned learning on, or a company's weekly run (due Monday 07:00 Chicago, with
// catch-up). A run never throws: a problem finishes it as failed, and the company keeps its current guidance.

import { learningKillSwitchOn } from "./scoutLearning.ts";
import { isUuid, type Surface } from "./scoutLearningCore.ts";
import {
  addDays,
  AGENT_SCHEMA,
  agentJob,
  agentSystemPrompt,
  appliedFactorOf,
  averageGap,
  buildComparisons,
  checkAnswer,
  type Comparison,
  CONTEXT_WEEKS,
  describeChanges,
  dueWeekStart,
  fitGuidance,
  type GuidanceContent,
  guidanceOf,
  projectedPrice,
  INITIAL_LOOKBACK_DAYS,
  isLargeMiss,
  localDate,
  localParts,
  type Miss,
  missesOf,
  newJobsFor,
  type RawJob,
  renderBlock,
  reportJob,
  RULES_CHANGED_ON,
  weekStartOf,
} from "./scoutLearningWeekly.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export const MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

export interface AgentReply { ok: boolean; status?: number; answer?: unknown; error?: string }
export type Agent = (system: string, input: unknown) => Promise<AgentReply>;
export interface Deps { now: Date; agent: Agent; budgetMs?: number }

type Kind = "initial" | "weekly" | "manual" | "preview";
interface RunRow {
  id: string; kind: Kind; week_start: string | null; status: string; claimed_at: string; finished_at: string | null;
  jobs: unknown; avg_gap_pct: number | null; summary: string | null; changes: unknown; guidance: unknown; block: string | null;
  active: boolean; undone_at: string | null; attempts: number;
}

export interface RunOutcome {
  status: "rewritten" | "unchanged" | "no_jobs" | "failed";
  calledAgent: boolean;
  fields: Record<string, unknown>;
  block: string | null;
  jobs: Comparison[];
}

const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);
const CHUNK = 80;

const CAPTURE_COLS = "id, owner_id, status, created_at, requested_service, final_service, ai_service, ai_price_min, " +
  "ai_price_max, ai_difficulty, ai_risk, ai_notes, diameter_inches, circumference_inches, free_preview_locked, " +
  "address_city, address_street, customer_name, photo_path";
const LEAD_COLS = "id, owner_contractor_id, source, is_sample, job_type, estimated_cost_min, estimated_cost_max, city, " +
  "created_at, customer_name, customer_address";
/** The newest jobs a run can read for one company (a large company's older jobs are past every window anyway). */
const MAX_REQUESTS = 1000;
const BID_COLS = "id, est_hours, crew_size, ground_crew_size, est_disposal_loads, needs_mini_skid, equipment";
const RUN_COLS = "id, kind, week_start, status, claimed_at, finished_at, jobs, avg_gap_pct, summary, changes, guidance, " +
  "block, active, undone_at, attempts";

/** Rows whose `column` is one of `ids`, read in chunks (long id lists don't fit one request). Throws on errors. */
async function rowsIn(admin: Admin, table: string, cols: string, column: string, ids: string[], surface?: Surface) {
  const out: Record<string, unknown>[] = [];
  const unique = [...new Set(ids.filter(isUuid))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    let q = admin.from(table).select(cols).in(column, unique.slice(i, i + CHUNK));
    if (surface) q = q.eq("surface", surface);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as Record<string, unknown>[]));
  }
  return out;
}

/** The owner and every teammate (a rep's auto-approved Scout job belongs to the rep's own id). */
async function teamIds(admin: Admin, company: string): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("id").eq("parent_contractor_id", company);
  if (error) throw new Error(`profiles: ${error.message}`);
  return [company, ...((data ?? []) as { id: string }[]).map((r) => r.id).filter(isUuid)];
}

/** A company's jobs with a pick, created on or after `since` (YYYY-MM-DD), for one estimator. */
export async function loadJobs(admin: Admin, company: string, surface: Surface, since: string): Promise<RawJob[]> {
  const team = await teamIds(admin, company);
  let q = admin.from("bid_requests")
    .select("id, capture_id, lead_id, quote_pick, city, created_at, role_needed, needs_stump_grinding, awarded_stump_bid_id, " +
      "pricing_inputs, customer_name, customer_address")
    .in("owner_contractor_id", team).not("quote_pick", "is", null).gte("created_at", `${since}T00:00:00Z`);
  q = surface === "scout" ? q.not("capture_id", "is", null) : q.not("lead_id", "is", null);
  const { data: requests, error } = await q.order("created_at", { ascending: false }).limit(MAX_REQUESTS);
  if (error) throw new Error(`bid_requests: ${error.message}`);
  const reqs = (requests ?? []) as Record<string, unknown>[];
  const refOf = (r: Record<string, unknown>) => (surface === "scout" ? r.capture_id : r.lead_id) as string;
  const refs = reqs.map(refOf);
  const sources = surface === "scout"
    ? await rowsIn(admin, "scout_captures", CAPTURE_COLS, "id", refs)
    : (await rowsIn(admin, "leads", LEAD_COLS, "id", refs))
      .filter((l) => l.source === "personal" && l.owner_contractor_id === company);
  const snapshots = await rowsIn(admin, "estimate_snapshots", "*", "ref_id", refs, surface);
  const bidIdOf = (r: Record<string, unknown>) => (r.quote_pick as Record<string, unknown> | null)?.bid_id as string;
  const bids = await rowsIn(admin, "bids", BID_COLS, "id", reqs.map(bidIdOf));
  const byId = (rows: Record<string, unknown>[], key = "id") => new Map(rows.map((r) => [r[key] as string, r]));
  const sourceMap = byId(sources);
  const snapMap = byId(snapshots, "ref_id");
  const bidMap = byId(bids);
  return reqs.map((r) => ({
    surface,
    ref: refOf(r),
    city: (r.city as string) ?? null,
    pick: r.quote_pick,
    source: sourceMap.get(refOf(r)) ?? null,
    snapshot: snapMap.get(refOf(r)) ?? null,
    bid: bidMap.get(bidIdOf(r)) ?? null,
    request: r,
  }));
}

/** The guidance each version id held, for the jobs whose estimates were made with one. */
async function loadVersions(admin: Admin, ids: string[]): Promise<Map<string, GuidanceContent | null>> {
  const rows = await rowsIn(admin, "scout_learning_runs", "id, guidance", "id", ids);
  return new Map(rows.map((r) => [r.id as string, guidanceOf(r.guidance)]));
}

/** The latest runs (about a year of weeks): enough for which jobs were used and the past weeks the agent sees. */
async function loadRuns(admin: Admin, company: string, surface: Surface): Promise<RunRow[]> {
  const { data, error } = await admin.from("scout_learning_runs").select(RUN_COLS)
    .eq("company_id", company).eq("surface", surface).order("claimed_at", { ascending: false }).limit(60);
  if (error) throw new Error(`scout_learning_runs: ${error.message}`);
  return (data ?? []) as RunRow[];
}

/** One run picked by its own query, so it is found however many weeks have passed (one first run per company and
 * estimator, one live run at most: both are unique indexes). */
async function oneRun(admin: Admin, company: string, surface: Surface, which: "initial" | "active"): Promise<RunRow | null> {
  let q = admin.from("scout_learning_runs").select(RUN_COLS).eq("company_id", company).eq("surface", surface);
  q = which === "initial" ? q.eq("kind", "initial") : q.eq("active", true);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`scout_learning_runs: ${error.message}`);
  return (data ?? null) as RunRow | null;
}

const refsOf = (run: RunRow): string[] =>
  Array.isArray(run.jobs) ? (run.jobs as Record<string, unknown>[]).map((j) => j?.ref as string).filter(isUuid) : [];

/**
 * Works out one run: the jobs it learns from, the agent's answer (checked by our code) and the block. Writes
 * nothing. `kind` initial or preview uses the company's past jobs; weekly uses the due week.
 */
export async function workOut(
  admin: Admin, deps: Deps, company: string, surface: Surface, kind: Kind, week: string | null,
): Promise<RunOutcome> {
  const today = localParts(deps.now).date;
  const runs = (await loadRuns(admin, company, surface)).filter((r) => r.kind === "initial" || r.kind === "weekly");
  const learning = kind === "weekly" ? "weekly" : runs.some((r) => r.status === "rewritten" || r.status === "unchanged")
    ? "weekly" : "initial";
  const used = new Set(runs.filter((r) => r.status === "rewritten" || r.status === "unchanged").flatMap(refsOf));
  const dueWeek = kind === "weekly" ? week : learning === "weekly" ? dueWeekStart(deps.now) : null;
  const since = dueWeek ? addDays(dueWeek, -7 * CONTEXT_WEEKS * 2 - 14) : addDays(today, -INITIAL_LOOKBACK_DAYS - 14);
  const all = buildComparisons(await loadJobs(admin, company, surface, since));
  const fresh = newJobsFor(all, learning, today, dueWeek, used);
  const empty = { jobs: [], avg_gap_pct: null, summary: null, changes: [], guidance: null, model: null };
  if (!fresh.length) return { status: "no_jobs", calledAgent: false, fields: empty, block: null, jobs: [] };

  const active = await oneRun(admin, company, surface, "active");
  const current: GuidanceContent | null = active ? guidanceOf(active.guidance) : null;
  const undone = runs.find((r) => r.undone_at);
  const earlier = dueWeek
    ? all.filter((c) => used.has(c.ref) && c.picked_on >= addDays(dueWeek, -7 * CONTEXT_WEEKS * 2)).slice(0, 40)
    : [];
  // Estimates made with guidance already hold its factor: the agent and the "would have priced" figure need it.
  const versions = await loadVersions(admin, [...fresh, ...earlier].map((c) => c.estimate.guidance_version).filter(isUuid));
  const applied = (c: Comparison) => appliedFactorOf(c, versions);
  const labelled = fresh.map((c, i) => ({ label: `J${i + 1}`, c }));
  const input = {
    surface,
    run_kind: learning,
    today,
    estimator_rules_changed_on: RULES_CHANGED_ON[surface],
    current_guidance: current,
    last_change_undone: undone ? { changes: undone.changes, undone_on: localDate(undone.undone_at) } : null,
    past_weeks: runs.filter((r) => r.status !== "running").slice(0, CONTEXT_WEEKS).map((r) => ({
      week_start: r.week_start, kind: r.kind, status: r.status, avg_gap_pct: r.avg_gap_pct, changes: r.changes,
      undone: !!r.undone_at,
    })),
    new_jobs: labelled.map(({ c, label }) => agentJob(c, label, true, applied(c))),
    earlier_jobs: earlier.map((c, i) => agentJob(c, `E${i + 1}`, false, applied(c))),
  };

  const reply = await deps.agent(agentSystemPrompt(surface), input);
  // Why each large miss happened is its own question: kept whatever happens to the guidance below.
  const misses = reply.ok ? missesOf(reply.answer, labelled) : new Map<string, Miss>();
  const report = { jobs: fresh.map((c) => reportJob(c, null, misses.get(c.ref))), avg_gap_pct: averageGap(fresh), model: MODEL };
  if (!reply.ok) {
    const error = reply.status === 402 ? "AI credits are used up" : reply.status === 429 ? "the AI was busy"
      : `the AI call failed${reply.status ? ` (${reply.status})` : ""}: ${reply.error ?? ""}`;
    return { status: "failed", calledAgent: true, fields: { ...report, summary: null, changes: [], guidance: null, error }, block: null, jobs: fresh };
  }
  const checked = checkAnswer(reply.answer, current, learning);
  if (!checked.ok) {
    return {
      status: "failed", calledAgent: true, block: null, jobs: fresh,
      fields: { ...report, summary: null, changes: [], guidance: null, error: `the AI's answer was refused: ${checked.error}` },
    };
  }
  const proposed = fitGuidance(surface, checked.guidance!);
  const block = renderBlock(surface, proposed);
  const nothingNew = !active && proposed.factors.length === 0 && proposed.rules.length === 0;
  const unchanged = checked.decision === "keep" || nothingNew || (active?.block ?? null) === block;
  // The owner reads what really changed (not the agent's own list), and is told when a limit held part of it back.
  const capped = !unchanged && checked.limited
    ? learning === "weekly"
      ? " This week's change was capped at 15 percent, so more may follow next week if the pattern holds."
      : " The adjustment is capped, so more may follow in the weekly updates if the pattern holds."
    : "";
  return {
    status: unchanged ? "unchanged" : "rewritten",
    calledAgent: true,
    block: unchanged ? (active?.block ?? null) : block,
    jobs: fresh,
    fields: {
      ...report,
      jobs: unchanged ? report.jobs : fresh.map((c) => reportJob(c, projectedPrice(c, applied(c), proposed), misses.get(c.ref))),
      summary: `${checked.summary}${capped}`,
      changes: unchanged ? [] : describeChanges(current, proposed),
      guidance: unchanged ? current : proposed,
    },
  };
}

async function finish(admin: Admin, runId: string, outcome: RunOutcome, keepBlock = false): Promise<void> {
  const { error } = await admin.rpc("scout_learning_finish", {
    p_run: runId,
    p_status: outcome.status,
    p_fields: outcome.fields,
    p_block: outcome.status === "rewritten" || keepBlock ? outcome.block : null,
  });
  if (error) console.error("scout learning: finishing the run failed", short(error.message));
}

/** Runs one claimed run to the end; any problem finishes it as failed. Returns whether the agent was called. */
async function runClaimed(
  admin: Admin, deps: Deps, runId: string, company: string, surface: Surface, kind: Kind, week: string | null,
): Promise<boolean> {
  try {
    const outcome = await workOut(admin, deps, company, surface, kind, week);
    if (kind === "preview") {
      // A preview keeps the block it would have used, whatever its status; it never goes live.
      const block = outcome.status === "rewritten" ? outcome.block
        : outcome.status === "unchanged" ? renderBlock(surface, guidanceOf(outcome.fields.guidance) ?? { factors: [], rules: [] })
        : null;
      await finish(admin, runId, { ...outcome, block }, true);
    } else {
      await finish(admin, runId, outcome);
    }
    return outcome.calledAgent;
  } catch (e) {
    console.error("scout learning: run failed", company.slice(0, 8), surface, short(e));
    await finish(admin, runId, {
      status: "failed", calledAgent: false, block: null, jobs: [],
      fields: { jobs: [], avg_gap_pct: null, summary: null, changes: [], guidance: null, model: MODEL, error: short(e) },
    });
    return false;
  }
}

/** How long a run may stay "running" before it counts as dead (the claim function uses the same 15 minutes). */
const STALE_MS = 15 * 60_000;

/**
 * Closes runs that died and will never be claimed again (a third attempt, or a preview, stuck "running"), so the
 * card stops saying a report is being worked out and a dead first run stops counting as pending.
 */
async function closeAbandoned(admin: Admin, now: Date): Promise<void> {
  const { data } = await admin.from("scout_learning_runs").select("id, kind, attempts")
    .eq("status", "running").lt("claimed_at", new Date(now.getTime() - STALE_MS).toISOString()).limit(20);
  for (const r of (data ?? []) as { id: string; kind: Kind; attempts: number }[]) {
    // A preview not yet taken (attempts 0) is waiting, not dead; other runs are reclaimed until their third try.
    if (r.kind === "preview" ? r.attempts < 1 : r.attempts < 3) continue;
    await admin.rpc("scout_learning_finish", {
      p_run: r.id, p_status: "failed", p_block: null,
      p_fields: { jobs: [], avg_gap_pct: null, summary: null, changes: [], guidance: null, model: MODEL, error: "stopped: no answer after the last try" },
    });
  }
}

/** Time an explanation may still need: one AI call (110 seconds at most) and the write. */
const EXPLAIN_MS = 115_000;

/**
 * Explains the large misses of a report finished before misses were explained (2026-10-27), once, so the latest
 * report on each company's card answers "why" too. Only the latest finished report of each company and estimator.
 * Same prompt and checks as a run, with that report's own jobs; the rest of the answer is ignored, so the guidance
 * never changes here. Writes only that report's jobs (service role, like scout_learning_finish): every job gets
 * large_miss whatever the answer, so a report is never asked about twice. Returns what ran when it called the AI.
 */
async function explainOldReport(
  admin: Admin, deps: Deps, companies: { company: string; surfaces: Surface[] }[],
): Promise<string | null> {
  for (const { company, surfaces } of companies) {
    for (const surface of surfaces) {
      const latest = (await loadRuns(admin, company, surface))
        .find((r) => (r.kind === "initial" || r.kind === "weekly") && r.status !== "running");
      if (!latest || (latest.status !== "rewritten" && latest.status !== "unchanged")) continue;
      const jobs = Array.isArray(latest.jobs)
        ? (latest.jobs as Record<string, unknown>[]).filter((j) => j && typeof j === "object")
        : [];
      if (!jobs.length || jobs.some((j) => "large_miss" in j)) continue;
      let misses = new Map<string, Miss>();
      let called = false;
      if (jobs.some((j) => isLargeMiss(Number(j.gap_pct)))) {
        const picks = jobs.map((j) => j.picked_on).filter((d): d is string => typeof d === "string").sort();
        const since = addDays(picks[0] ?? localParts(deps.now).date, -INITIAL_LOOKBACK_DAYS - 14);
        const all = new Map(buildComparisons(await loadJobs(admin, company, surface, since)).map((c) => [c.ref, c]));
        // Only jobs that still read as the report shows them: a pick changed since would explain some other gap.
        const found = jobs.flatMap((j) => {
          const c = all.get(j.ref as string);
          return c && c.gap_pct === Number(j.gap_pct) ? [c] : [];
        });
        if (found.some((c) => isLargeMiss(c.gap_pct))) {
          const versions = await loadVersions(admin, found.map((c) => c.estimate.guidance_version).filter(isUuid));
          const labelled = found.map((c, i) => ({ label: `J${i + 1}`, c }));
          const reply = await deps.agent(agentSystemPrompt(surface), {
            surface,
            run_kind: latest.kind,
            today: localDate(latest.finished_at) ?? localParts(deps.now).date,
            estimator_rules_changed_on: RULES_CHANGED_ON[surface],
            current_guidance: null,
            last_change_undone: null,
            past_weeks: [],
            new_jobs: labelled.map(({ c, label }) => agentJob(c, label, true, appliedFactorOf(c, versions))),
            earlier_jobs: [],
          });
          called = true;
          if (reply.ok) misses = missesOf(reply.answer, labelled);
          else console.warn("scout learning: explaining an earlier report failed", company.slice(0, 8), reply.status ?? "", reply.error ?? "");
        }
      }
      const updated = jobs.map((j) => {
        const miss = misses.get(j.ref as string);
        return { ...j, large_miss: isLargeMiss(Number(j.gap_pct)), ...(miss ? { miss } : {}) };
      });
      const { error } = await admin.from("scout_learning_runs").update({ jobs: updated })
        .eq("id", latest.id).eq("status", latest.status);
      if (error) console.error("scout learning: saving the explanations failed", short(error.message));
      if (called) return `explain ${surface}`;
    }
  }
  return null;
}

/** One scheduled tick. Never throws. */
export async function runTick(admin: Admin, deps: Deps): Promise<{ ran: string[] }> {
  const ran: string[] = [];
  if (learningKillSwitchOn()) return { ran };
  const started = Date.now();
  const budget = deps.budgetMs ?? 140_000;
  let calls = 0;
  const learning: { company: string; surfaces: Surface[] }[] = [];
  try {
    await closeAbandoned(admin, deps.now);
    // 1. A preview Haris asked for (SQL editor), oldest first; taken by exactly one tick.
    const { data: previews } = await admin.from("scout_learning_runs").select("id, company_id, surface")
      .eq("kind", "preview").eq("status", "running").eq("attempts", 0).order("claimed_at", { ascending: true }).limit(1);
    for (const p of (previews ?? []) as { id: string; company_id: string; surface: Surface }[]) {
      const { data: taken } = await admin.from("scout_learning_runs").update({ attempts: 1, claimed_at: deps.now.toISOString() })
        .eq("id", p.id).eq("attempts", 0).select("id");
      if (!Array.isArray(taken) || !taken.length) continue;
      if (await runClaimed(admin, deps, p.id, p.company_id, p.surface, "preview", null)) calls++;
      ran.push(`preview ${p.surface}`);
    }

    // 2. Companies that turned learning on: their first run, then one run a week.
    const { data: settings, error } = await admin.from("company_settings")
      .select("contractor_id, scout_learning_website").eq("scout_learning_enabled", true);
    if (error) { console.error("scout learning: reading the switches failed", short(error.message)); return { ran }; }
    for (const s of (settings ?? []) as { contractor_id: string; scout_learning_website: boolean }[]) {
      if (calls >= 1 || Date.now() - started > budget) break;
      const company = s.contractor_id;
      if (!isUuid(company)) continue;
      try {
        const { data: profile } = await admin.from("profiles").select("is_sandbox, parent_contractor_id").eq("id", company).maybeSingle();
        if (!profile || profile.is_sandbox === true || profile.parent_contractor_id) continue;
        const { data: plan } = await admin.rpc("company_plan", { p_owner: company });
        if (plan !== "paid" && plan !== "trialing") continue;
        const surfaces: Surface[] = s.scout_learning_website ? ["scout", "website"] : ["scout"];
        learning.push({ company, surfaces });
        for (const surface of surfaces) {
          if (calls >= 1 || Date.now() - started > budget) break;
          const initial = await oneRun(admin, company, surface, "initial");
          // The first run is settled once it finished, or failed all three tries: the weekly runs then take over
          // (their 8-week window picks up the jobs it would have used), instead of the company waiting forever.
          const settled = !!initial && (initial.status === "rewritten" || initial.status === "unchanged" ||
            initial.status === "no_jobs" || (initial.status === "failed" && initial.attempts >= 3));
          if (!settled) {
            const { data: id } = await admin.rpc("scout_learning_claim", { p_company: company, p_surface: surface, p_kind: "initial", p_week: null });
            if (!isUuid(id)) continue;
            if (await runClaimed(admin, deps, id, company, surface, "initial", null)) calls++;
            ran.push(`initial ${surface}`);
            continue;
          }
          const week = dueWeekStart(deps.now);
          const initialWeek = weekStartOf(localDate(initial.claimed_at) ?? localParts(deps.now).date);
          if (week <= initialWeek) continue;
          const { data: id } = await admin.rpc("scout_learning_claim", { p_company: company, p_surface: surface, p_kind: "weekly", p_week: week });
          if (!isUuid(id)) continue;
          if (await runClaimed(admin, deps, id, company, surface, "weekly", week)) calls++;
          ran.push(`weekly ${surface} ${week}`);
        }
      } catch (e) {
        console.warn("scout learning: company skipped", company.slice(0, 8), short(e));
      }
    }

    // 3. Only when this tick made no AI call: a report from before misses were explained gets them, once.
    if (calls === 0 && Date.now() - started < budget - EXPLAIN_MS) {
      const explained = await explainOldReport(admin, deps, learning);
      if (explained) ran.push(explained);
    }
  } catch (e) {
    console.error("scout learning: tick failed", short(e));
  }
  return { ran };
}

/** Reads the gateway's streamed answer (Responses API events) into the output text. */
export async function readStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const ev = JSON.parse(data);
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
      } catch { /* a partial event */ }
    }
  }
  return text;
}

/** The agent: one Lovable AI Gateway call (Responses API, strict JSON schema, nothing stored). */
export function gatewayAgent(apiKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = 110_000): Agent {
  return async (system, input) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(GATEWAY, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "fetch",
        },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          store: false,
          reasoning: { effort: "medium" },
          input: [
            { role: "system", content: [{ type: "input_text", text: system }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] },
          ],
          text: { format: { type: "json_schema", name: "company_guidance", strict: true, schema: AGENT_SCHEMA } },
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        return { ok: false, status: res.status, error: (await res.text().catch(() => "")).slice(0, 200) };
      }
      const text = await readStream(res.body);
      try {
        return { ok: true, answer: JSON.parse(text) };
      } catch {
        return { ok: false, error: "the answer was not JSON" };
      }
    } catch (e) {
      return { ok: false, error: controller.signal.aborted ? "timed out" : short(e) };
    } finally {
      clearTimeout(timer);
    }
  };
}
