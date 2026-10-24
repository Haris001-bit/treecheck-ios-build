// Scout learning's weekly run (App Improvements milestone 4). crew-release-holds calls it every 10 minutes with the
// service key; it replies at once and works after replying (one AI call per tick at most): a preview Haris asked
// for in the SQL editor, a company's first run after it turned learning on, or its run for the past week (due
// Monday 07:00 Chicago, with catch-up). It never texts anyone and never writes to Scout, n8n or Jobber: its only
// output is the company's guidance (scout_learning_runs), which scout-submit and the website estimator read.
// Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { learningKillSwitchOn } from "../_shared/scoutLearning.ts";
import { gatewayAgent, runTick } from "../_shared/scoutLearningRun.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

/** Runs the work after the reply when the runtime supports it; otherwise waits for it before replying. */
async function afterReply(work: Promise<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  const guarded = work.catch((e: unknown) => console.error("scout-learning-run: run failed", short(e)));
  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(guarded);
    return;
  }
  await guarded;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!SERVICE || bearer !== SERVICE) return json({ ok: false, error: "Unauthorized" }, 401);
  if (learningKillSwitchOn()) return json({ ok: true, skipped: "kill_switch" });
  const AI_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
  if (!AI_KEY) return json({ ok: false, error: "LOVABLE_API_KEY is not set" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  await afterReply(runTick(admin, { now: new Date(), agent: gatewayAgent(AI_KEY) }).then((r) => {
    if (r.ran.length) console.log("scout-learning-run:", r.ran.join(", "));
  }));
  return json({ ok: true, started: true });
});
