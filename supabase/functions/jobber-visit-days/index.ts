// Jobber's visit days for the Jobs calendar (JS2). crew-release-holds calls it every 10 minutes with the service
// key; it replies at once and syncs after replying. For each company with quotes_on_award on and Jobber connected,
// it saves the local days of its TreeCheck-quoted jobs' Jobber visits (job ids and dates only), so calendar_jobs()
// shows Jobber's schedule in the office view. Reads Jobber only: no Jobber writes and no texts. A company is synced
// at most once every 9 minutes (claim_jobber_visit_days). Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { jobberSwitches, killSwitchOn } from "../_shared/jobberSwitches.ts";
import { syncVisitDays } from "../_shared/jobberVisitDays.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// The whole run, and one company's Jobber read at most.
const TIME_BUDGET_MS = 45_000;
const COMPANY_BUDGET_MS = 20_000;

const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

/** Runs the work after the reply when the runtime supports it; otherwise waits for it before replying. */
async function afterReply(work: Promise<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  const guarded = work.catch((e: unknown) => console.error("jobber-visit-days: run failed", short(e)));
  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(guarded);
    return;
  }
  await guarded;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runAll(admin: any): Promise<void> {
  const started = Date.now();
  const { data, error } = await admin.from("company_jobber_settings").select("contractor_id").eq("quotes_on_award", true);
  if (error) {
    console.warn("jobber-visit-days: reading the companies failed", short(error.message ?? error));
    return;
  }
  for (const row of (data ?? []) as Array<{ contractor_id?: string }>) {
    const left = TIME_BUDGET_MS - (Date.now() - started);
    if (left < 5_000) {
      console.warn("jobber-visit-days: out of time, the other companies wait for the next run");
      return;
    }
    const ownerId = row.contractor_id;
    if (!ownerId) continue;
    try {
      // Read again per company: the kill switch or the company's switch may have changed since the list was read.
      const switches = await jobberSwitches(admin, ownerId);
      if (!switches.quotesOnAward) continue;
      await syncVisitDays(admin, ownerId, { tz: switches.timezone, budgetMs: Math.min(COMPANY_BUDGET_MS, left - 3_000) });
    } catch (e) {
      console.warn("jobber-visit-days: company failed", ownerId.slice(0, 8), short(e));
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!SERVICE || bearer !== SERVICE) return json({ ok: false, error: "Unauthorized" }, 401);
  if (killSwitchOn()) return json({ ok: true, skipped: "kill_switch" });

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  await afterReply(runAll(admin));
  return json({ ok: true, started: true });
});
