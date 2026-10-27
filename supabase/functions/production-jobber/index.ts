// Large-company setup: Jobber events for crew estimates. jobber-webhook calls it with the service key, after a quick
// check that the event can concern one of the company's crew estimates, and logs the outcome it returns. A quote's
// approval makes the job packets; changes requested and archive follow; the jobs and visits the office makes from the
// quote link the packets, bring back the scheduled day and mark them done when Jobber closes the job. Reads Jobber only:
// no Jobber writes and no texts. Off with TC_JOBBER_KILL or TC_PRODUCTION_KILL, and for companies outside the rollout.
// Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { killSwitchOn } from "../_shared/jobberSwitches.ts";
import { applyQuoteEvent, productionJobberOn, productionKillOn, refreshJob, refreshVisit } from "../_shared/productionJobber.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const short = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);
const ID = /^[A-Za-z0-9_=+/-]{1,200}$/;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!SERVICE || bearer !== SERVICE) return json({ ok: false, error: "Unauthorized" }, 401);
  if (killSwitchOn() || productionKillOn()) return json({ ok: true, outcome: "off (kill switch)" });

  const body = await req.json().catch(() => null) as { ownerId?: unknown; topic?: unknown; itemId?: unknown } | null;
  const ownerId = typeof body?.ownerId === "string" ? body.ownerId : "";
  const topic = typeof body?.topic === "string" ? body.topic : "";
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!/^[0-9a-f-]{36}$/.test(ownerId) || !/^(QUOTE|JOB|VISIT)_[A-Z_]+$/.test(topic) || !ID.test(itemId)) {
    return json({ ok: false, error: "Bad request" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  if (!(await productionJobberOn(admin, ownerId))) return json({ ok: true, outcome: "company not in the large-company rollout" });
  try {
    let outcome: string;
    if (topic === "QUOTE_DESTROY") outcome = "quote deleted in Jobber, left as is";
    else if (topic.startsWith("QUOTE_")) outcome = await applyQuoteEvent(admin, ownerId, itemId);
    else if (topic.startsWith("JOB_")) outcome = await refreshJob(admin, ownerId, itemId);
    else if (topic === "VISIT_DESTROY") outcome = "visit deleted, the job's next change brings the day back";
    else outcome = await refreshVisit(admin, ownerId, itemId);
    return json({ ok: true, outcome });
  } catch (e) {
    console.error("production-jobber error", topic, short(e));
    return json({ ok: false, outcome: `failed: ${short(e)}` }, 500);
  }
});
