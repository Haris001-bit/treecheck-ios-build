import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { sendPush, sendSms } from "../_shared/crewRecipients.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.object({
  bid_request_id: z.string().uuid(),
  crew_member_id: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

const THROTTLE_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { bid_request_id, crew_member_id, body } = parsed.data;

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: r }, { data: crew }, { data: me }] = await Promise.all([
      admin.from("bid_requests").select("id, title, city, owner_contractor_id").eq("id", bid_request_id).maybeSingle(),
      admin.from("crew_members").select("id, user_id, phone, full_name, owner_contractor_id").eq("id", crew_member_id).maybeSingle(),
      admin.from("profiles").select("id, full_name, company_name, parent_contractor_id, is_sandbox").eq("id", user.id).maybeSingle(),
    ]);
    if (!r || !crew || crew.owner_contractor_id !== r.owner_contractor_id) return json({ error: "Not found" }, 404);

    // The sub must be on this job: an offer, or a ground-crew claim.
    const { count: bidCount } = await admin.from("bids").select("id", { count: "exact", head: true })
      .eq("bid_request_id", r.id).eq("crew_member_id", crew.id);
    let onJob = (bidCount ?? 0) > 0;
    if (!onJob) {
      const { data: disp } = await admin.from("job_dispatches").select("id").eq("bid_request_id", r.id);
      const ids = (disp ?? []).map((d: any) => d.id);
      if (ids.length) {
        const { count } = await admin.from("job_dispatch_responses").select("id", { count: "exact", head: true })
          .in("dispatch_id", ids).eq("crew_member_id", crew.id);
        onJob = (count ?? 0) > 0;
      }
    }
    if (!onJob) return json({ error: "This person hasn't made an offer on this job." }, 403);

    const ownerId = r.owner_contractor_id;
    const myParent = me?.parent_contractor_id ?? user.id;
    let side: "office" | "crew";
    if (crew.user_id === user.id) side = "crew";
    else if (myParent === ownerId) side = "office";
    else return json({ error: "Forbidden" }, 403);
    if (side === 'office') {
      const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
      const { data: allowed, error } = await caller.rpc('company_has_permission', { p_owner: ownerId, p_permission: 'manageJobsSubs' });
      if (error || !allowed) return json({ error: 'Company Jobs and Subs permission required.' }, 403);
    }

    const { data: owner } = await admin.from("profiles").select("id, phone, company_name, is_sandbox").eq("id", ownerId).maybeSingle();
    const senderName = side === "crew"
      ? (crew.full_name || "Crew")
      : ((me?.full_name || "").split(" ")[0] || owner?.company_name || "Office");

    const { data: msg, error: insErr } = await admin.from("job_messages").insert({
      bid_request_id: r.id, crew_member_id: crew.id, sender_user_id: user.id, sender_name: senderName, sender_side: side, body,
    }).select("id, created_at").single();
    if (insErr) throw insErr;

    // Sender has obviously read the thread.
    await admin.from("job_message_reads").upsert({
      user_id: user.id, bid_request_id: r.id, crew_member_id: crew.id, last_read_at: new Date().toISOString(),
    }, { onConflict: "user_id,bid_request_id,crew_member_id" });

    const sandbox = me?.is_sandbox === true || owner?.is_sandbox === true;
    const crewLink = `https://app.treecheck.ai/dashboard/crew-bids?job=${r.id}&chat=${crew.id}`;
    const officeLink = `https://app.treecheck.ai/dashboard/bid-board?job=${r.id}&chat=${crew.id}`;
    const crewName = crew.full_name || "the crew";

    // Office team = owner plus team members who aren't crew accounts.
    const officeTeam = async () => {
      const { data: team } = await admin.from("profiles").select("id, phone").eq("parent_contractor_id", ownerId);
      const teamIds = (team ?? []).map((p: any) => p.id);
      const { data: crewUsers } = teamIds.length
        ? await admin.from("crew_members").select("user_id").in("user_id", teamIds) : { data: [] };
      const crewSet = new Set((crewUsers ?? []).map((c: any) => c.user_id));
      const out: { id: string; phone: string | null }[] = [];
      if (owner) out.push({ id: owner.id, phone: owner.phone });
      for (const p of team ?? []) if (!crewSet.has(p.id)) out.push({ id: p.id, phone: p.phone });
      return out;
    };

    // Who to alert, each with the wording that fits them.
    const recipients: { id: string; phone: string | null; text: string; title: string; link: string }[] = [];
    if (side === "office") {
      const fromWho = owner?.company_name || "the office";
      if (crew.user_id) {
        recipients.push({
          id: crew.user_id, phone: crew.phone, link: crewLink, title: "You have a message",
          text: `TreeCheck: You have a new message from ${fromWho} about "${r.title}". Reply in the app: ${crewLink}`,
        });
      }
      // Keep the rest of the office in the loop.
      for (const p of await officeTeam()) {
        recipients.push({
          id: p.id, phone: p.phone, link: officeLink, title: "Team message sent",
          text: `TreeCheck: ${senderName} messaged ${crewName} about "${r.title}". See it in the app: ${officeLink}`,
        });
      }
    } else {
      for (const p of await officeTeam()) {
        recipients.push({
          id: p.id, phone: p.phone, link: officeLink, title: "You have a message",
          text: `TreeCheck: You have a new message from ${senderName} about "${r.title}". Reply in the app: ${officeLink}`,
        });
      }
    }

    const seenPhones = new Set<string>();
    const seenIds = new Set<string>([user.id]);
    let attempted = 0, sent = 0;
    const pushes: { id: string; title: string; text: string; link: string }[] = [];
    const now = Date.now();
    for (const rc of recipients) {
      if (seenIds.has(rc.id)) continue;
      seenIds.add(rc.id);
      const { data: mark } = await admin.from("job_message_reads").select("last_alert_at")
        .eq("user_id", rc.id).eq("bid_request_id", r.id).eq("crew_member_id", crew.id).maybeSingle();
      if (mark?.last_alert_at && now - new Date(mark.last_alert_at).getTime() < THROTTLE_MS) continue;
      const stamp = new Date().toISOString();
      if (mark) {
        await admin.from("job_message_reads").update({ last_alert_at: stamp })
          .eq("user_id", rc.id).eq("bid_request_id", r.id).eq("crew_member_id", crew.id);
      } else {
        await admin.from("job_message_reads").insert({
          user_id: rc.id, bid_request_id: r.id, crew_member_id: crew.id,
          last_read_at: new Date(0).toISOString(), last_alert_at: stamp,
        });
      }
      pushes.push({ id: rc.id, title: rc.title, text: `About "${r.title}"`, link: rc.link });
      const digits = String(rc.phone ?? "").replace(/\D/g, "").slice(-10);
      if (!digits || seenPhones.has(digits) || sandbox) continue;
      seenPhones.add(digits);
      attempted++;
      if (await sendSms(String(rc.phone), rc.text)) sent++;
    }
    if (!sandbox && pushes.length) {
      for (const p of pushes) {
        await sendPush([p.id], p.title, p.text, { url: p.link });
      }
    }


    return json({ saved: true, id: msg.id, attempted, sent, alerted: attempted === 0 ? null : sent === attempted });
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
