// Two-way reviews after a completed job.
// action 'targets': who can I rate on this job?   action 'submit': save a review.
// action 'respond': reply once to a review about me.
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { hiredCrew } from "../_shared/jobParticipants.ts";
import { sendSms, sendPush } from "../_shared/crewRecipients.ts";
import { companyMode } from "../_shared/tcNotify.ts";
import { notifySubReview } from "./notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("targets"), bid_request_id: z.string().uuid() }),
  z.object({
    action: z.literal("submit"),
    bid_request_id: z.string().uuid(),
    reviewee_user_id: z.string().uuid(),
    stars: z.number().int().min(1).max(5),
    tags: z.array(z.string().max(40)).max(10).default([]),
    comment: z.string().max(1000).optional().nullable(),
  }),
  z.object({ action: z.literal("respond"), review_id: z.string().uuid(), response: z.string().min(1).max(1000) }),
]);

/** Ask the AI whether a comment is abusive. Fails open to "needs review" only on clear signals. */
async function screenComment(text: string): Promise<boolean> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return false;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: "You moderate reviews between tree companies and subcontractors. Reply with exactly FLAG if the review contains profanity aimed at a person, slurs, threats, harassment, sexual content, or personal information like phone numbers or home addresses. Otherwise reply exactly OK. Honest negative feedback is OK.",
          },
          { role: "user", content: text },
        ],
      }),
    });
    const j = await r.json();
    return String(j?.choices?.[0]?.message?.content ?? "").trim().toUpperCase().startsWith("FLAG");
  } catch (e) {
    console.warn("screen failed", e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const { data: u } = await admin.auth.getUser(auth.replace("Bearer ", ""));
    if (!u?.user) return json({ error: "Unauthorized" }, 401);
    const me = u.user.id;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const body = parsed.data;

    if (body.action === "respond") {
      const { data: rv } = await admin.from("reviews").select("*").eq("id", body.review_id).maybeSingle();
      if (!rv) return json({ error: "Review not found" }, 404);
      const { data: prof } = await admin.from("profiles").select("parent_contractor_id").eq("id", me).maybeSingle();
      const myOwner = prof?.parent_contractor_id ?? me;
      if (rv.reviewee_user_id !== me && rv.reviewee_user_id !== myOwner) return json({ error: "Not your review" }, 403);
      if (rv.response) return json({ error: "You already responded" }, 400);
      await admin.from("reviews").update({ response: body.response.trim(), responded_at: new Date().toISOString() }).eq("id", rv.id);
      return json({ success: true });
    }

    const { data: request } = await admin.from("bid_requests").select("*").eq("id", body.bid_request_id).maybeSingle();
    if (!request) return json({ error: "Job not found" }, 404);
    if (request.workflow_status !== "job_complete") return json({ error: "Ratings open once the job is marked complete" }, 400);

    const { data: prof } = await admin.from("profiles").select("parent_contractor_id").eq("id", me).maybeSingle();
    const myOwner = prof?.parent_contractor_id ?? me;
    const isCompanySide = myOwner === request.owner_contractor_id;
    const crew = await hiredCrew(admin, request);
    const isCrewSide = crew.some((c) => c.user_id === me);
    if (!isCompanySide && !isCrewSide) return json({ error: "Only people who worked this job can rate it" }, 403);

    const { data: company } = await admin.from("profiles")
      .select("company_name, full_name").eq("id", request.owner_contractor_id).maybeSingle();
    const targets = isCompanySide
      ? crew.flatMap((c) => c.user_id ? [{ user_id: c.user_id, name: c.full_name ?? "Sub", type: "crew", trade: c.trade }] : [])
      : [{ user_id: request.owner_contractor_id, name: company?.company_name || company?.full_name || "Company", type: "company", trade: null }];

    const { data: mine } = await admin.from("reviews")
      .select("reviewee_user_id, stars").eq("bid_request_id", request.id).eq("reviewer_user_id", me);
    const done = new Map((mine ?? []).map((r: any) => [r.reviewee_user_id, r.stars]));

    if (body.action === "targets") {
      // Reviews written about me on this job. Stars and words only once revealed (double-blind).
      const aboutIds = isCompanySide ? [request.owner_contractor_id] : [me];
      const { data: about } = await admin.from("reviews")
        .select("stars, tags, comment, comment_hidden, status, revealed_at, reviewer_type")
        .eq("bid_request_id", request.id).in("reviewee_user_id", aboutIds);
      const nowIso = new Date().toISOString();
      const about_me = (about ?? []).map((r: any) => {
        const shown = r.status === "published" && r.revealed_at && r.revealed_at <= nowIso;
        return shown
          ? { revealed: true, from: r.reviewer_type === "company" ? (company?.company_name || company?.full_name || "The company") : "Your sub", stars: r.stars, tags: r.tags ?? [], comment: r.comment_hidden ? null : r.comment }
          : { revealed: false, from: r.reviewer_type === "company" ? (company?.company_name || company?.full_name || "The company") : "Your sub", reveal_at: r.revealed_at };
      });
      return json({
        title: request.title ?? null,
        targets: targets.map((t) => ({ ...t, my_stars: done.get(t.user_id) ?? null })),
        about_me,
      });
    }

    const target = targets.find((t) => t.user_id === body.reviewee_user_id);
    if (!target) return json({ error: "You can't rate that person for this job" }, 403);
    if (done.has(target.user_id)) return json({ error: "You already rated them for this job" }, 400);

    const comment = body.comment?.trim() || null;
    const flagged = comment ? await screenComment(comment) : false;

    const { data: inserted, error } = await admin.from("reviews").insert({
      bid_request_id: request.id,
      reviewer_user_id: me,
      reviewer_type: isCompanySide ? "company" : "crew",
      reviewee_type: target.type,
      reviewee_user_id: target.user_id,
      company_id: request.owner_contractor_id,
      stars: body.stars,
      tags: body.tags,
      comment,
      status: flagged ? "pending_review" : "published",
    }).select("id").single();
    if (error) return json({ error: error.message }, 400);

    if (flagged) {
      await admin.from("review_reports").insert({ review_id: inserted.id, reporter_user_id: null, reason: "other", notes: "Held automatically for review" });
    }

    // Double-blind: when the other side has also rated, reveal both now.
    const { data: counter } = await admin.from("reviews")
      .select("id").eq("bid_request_id", request.id)
      .eq("reviewer_user_id", target.type === "company" ? request.owner_contractor_id : target.user_id)
      .eq("reviewee_user_id", isCompanySide ? target.user_id : me);
    if (counter?.length) {
      await admin.from("reviews").update({ revealed_at: new Date().toISOString() })
        .in("id", [inserted.id, ...counter.map((c: any) => c.id)]);
    }

    if (isCompanySide) {
      try {
        const sandbox = (await companyMode(admin, request.owner_contractor_id)) === "sandbox";
        const member = crew.find((c) => c.user_id === target.user_id);
        const { data: contact } = !sandbox && member
          ? await admin.from("crew_members").select("phone").eq("id", member.crew_member_id).maybeSingle()
          : { data: null };
        await notifySubReview({ companySide: true, sandbox, userId: target.user_id, phone: contact?.phone ?? null, company: company?.company_name || company?.full_name || "The company", jobId: request.id }, { sms: sendSms, push: sendPush });
      } catch {
        console.warn("review notification failed after save");
      }
    }
    return json({ success: true, held_for_review: flagged });
  } catch (e) {
    console.error("review-submit", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
