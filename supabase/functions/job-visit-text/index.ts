// Office tool: text the client a link to book a free on-site visit, flag the job
// "Needs site visit", and let the office (e.g. LesLee) know.
//  action "send": body { bid_request_id, estimate_view: right|high|low|none, message }
//  action "done": body { bid_request_id } clears the "Needs site visit" label.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendPush, sendSms } from "../_shared/crewRecipients.ts";
import { companyMode } from "../_shared/tcNotify.ts";
import { requireCompanyPermission } from '../_shared/companyPermission.ts';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const digits = (p: unknown) => String(p ?? "").replace(/\D/g, "");
const VIEWS = new Set(["right", "high", "low", "none"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: u } = token ? await admin.auth.getUser(token) : { data: null };
    if (!u?.user) return json({ error: "Please sign in again." }, 401);

    const body = await req.json().catch(() => ({}));
    const id = typeof body.bid_request_id === "string" ? body.bid_request_id : null;
    if (!id) return json({ error: "bid_request_id required" }, 400);

    const { data: r } = await admin.from("bid_requests")
      .select("id, owner_contractor_id, title, city, customer_name, customer_phone, visit_text_sent_at")
      .eq("id", id).maybeSingle();
    if (!r) return json({ error: "Job not found" }, 404);
    const { data: me } = await admin.from("profiles").select("parent_contractor_id, full_name, phone").eq("id", u.user.id).maybeSingle();
    if ((me?.parent_contractor_id ?? u.user.id) !== r.owner_contractor_id) return json({ error: "Not your job" }, 403);
    await requireCompanyPermission(req, r.owner_contractor_id, 'manageJobsSubs');

    if (body.action === "done") {
      await admin.from("bid_requests").update({ needs_site_visit: false, site_visit_done_at: new Date().toISOString() }).eq("id", id);
      return json({ ok: true });
    }

    const view = VIEWS.has(body.estimate_view) ? body.estimate_view : "none";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length < 10 || message.length > 1200) return json({ error: "The text must be 10 to 1,200 characters." }, 400);
    if (digits(r.customer_phone).length < 10) return json({ error: "This job has no client mobile number." }, 400);
    if (r.visit_text_sent_at && Date.now() - new Date(r.visit_text_sent_at).getTime() < 10 * 60_000) {
      return json({ error: "A visit text was just sent. Wait 10 minutes to send another." }, 429);
    }

    // Testville jobs and sandbox (demo) companies never send real texts.
    const sandbox = /testville/i.test(String(r.city ?? "")) ||
      (await companyMode(admin, r.owner_contractor_id)) === "sandbox";
    const sent = sandbox ? true : await sendSms(String(r.customer_phone), message);
    if (!sent) return json({ error: "The text couldn't be sent. Please try again." }, 502);

    await admin.from("bid_requests").update({
      visit_text_sent_at: new Date().toISOString(), visit_text_estimate_view: view, visit_text_body: message,
      needs_site_visit: true, site_visit_done_at: null,
    }).eq("id", id);

    // Tell the office (everyone on the team except the sender).
    if (!sandbox) {
      const [{ data: owner }, { data: team }] = await Promise.all([
        admin.from("profiles").select("id, phone").eq("id", r.owner_contractor_id).maybeSingle(),
        admin.from("profiles").select("id, phone, is_active").eq("parent_contractor_id", r.owner_contractor_id),
      ]);
      // deno-lint-ignore no-explicit-any
      const people = [owner, ...((team ?? []) as any[]).filter((p) => p.is_active !== false)]
        .filter((p) => p && p.id !== u.user.id);
      const who = (me?.full_name || "The owner").split(" ")[0];
      const client = r.customer_name || "a client";
      const link = `https://app.treecheck.ai/dashboard/bid-board?job=${r.id}`;
      const note = `${who} needs to see ${client}${r.city ? ` in ${r.city}` : ""} in person. A scheduling link was sent. ${link}`;
      const seen = new Set<string>([digits(me?.phone)]);
      for (const p of people) {
        const d = digits(p.phone);
        if (d.length >= 10 && !seen.has(d)) { seen.add(d); await sendSms(String(p.phone), note); }
      }
      await sendPush(people.map((p) => p.id), "Site visit needed", `${who} needs to see ${client} in person.`,
        { route: `/dashboard/bid-board?job=${r.id}`, bid_request_id: r.id });
    }
    return json({ ok: true, sandbox });
  } catch (e) {
    console.error("job-visit-text", e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong" }, 500);
  }
});
