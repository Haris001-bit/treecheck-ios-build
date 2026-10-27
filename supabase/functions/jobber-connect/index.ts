// Returns a Jobber OAuth authorize URL for the caller to visit.
// Until Jobber approves the app, a company gets the link only while a Jobber place is theirs (JC1,
// jobber_claim_connect): otherwise it sees Mark's stand by message and Mark gets one text and email about it.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  JOBBER_WAITLIST_CODE,
  JOBBER_WAITLIST_MESSAGE,
  JOBBER_WAITLIST_TITLE,
  waitlistAlertEmail,
  waitlistAlertText,
} from "../_shared/connectWaitlist.ts";
import { notifyCtx, sendEmail, sendSms } from "../_shared/tcNotify.ts";

// Mark's phone and TreeCheck admin email, the ones crm-interest-alert uses.
const ADMIN_PHONE = "+13036693816";
const ADMIN_EMAIL = "mark@tradesmarketing.ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const REDIRECT_URI = "https://wsbtxxobbvcdxiovnssi.functions.supabase.co/jobber-oauth-callback";
// Where the owner may be sent back to after connecting (origin allowlist, /dashboard/ paths only).
const RETURN_ORIGINS = new Set([
  "https://trccai.lovable.app",
  "https://treecheck.ai",
  "https://www.treecheck.ai",
  "https://app.treecheck.ai",
]);

function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try {
    const u = new URL(raw);
    if (!RETURN_ORIGINS.has(u.origin) || !u.pathname.startsWith("/dashboard/")) return null;
    return u.origin + u.pathname + u.search;
  } catch {
    return null;
  }
}
const SCOPES = "read_clients write_clients read_requests write_requests read_quotes write_quotes read_jobs write_jobs read_notes write_notes";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CLIENT_ID = Deno.env.get("JOBBER_CLIENT_ID");
    if (!CLIENT_ID) return json({ error: "JOBBER_CLIENT_ID not configured" }, 500);

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Jobber is connected once per company, by the account owner. A team member's connection
    // would be stored under the team member and never used for the company.
    const { data: prof, error: pErr } = await admin
      .from("profiles").select("parent_contractor_id").eq("id", u.user.id).maybeSingle();
    if (pErr) throw new Error(`profile read failed: ${pErr.message}`);
    if (prof?.parent_contractor_id) {
      // 200 with a code so the page can show the message (the client hides non-2xx bodies).
      return json({ error: "Only the account owner can connect Jobber. Ask your account owner to connect it.", code: "owner_only" });
    }

    let returnTo: string | null = null;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      returnTo = safeReturnTo(body?.return_to);
    }

    // Tidy up this owner's abandoned attempts, then record the new one.
    await admin.from("jobber_oauth_states").delete()
      .eq("contractor_id", u.user.id)
      .lt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
    const state = crypto.randomUUID();
    // JC1: the state is recorded only through the claim, which refuses when no Jobber place is this company's.
    const { data: claim, error: cErr } = await admin.rpc("jobber_claim_connect", {
      p_owner: u.user.id,
      p_state: state,
      p_return_to: returnTo,
    });
    if (cErr) throw new Error(`connect claim failed: ${cErr.message}`);
    if (claim?.allowed !== true) {
      await alertMark(admin, u.user.id, claim);
      // 200 with a code so the page can show the popup (older apps show the message as an error note).
      return json({ code: JOBBER_WAITLIST_CODE, title: JOBBER_WAITLIST_TITLE, error: JOBBER_WAITLIST_MESSAGE });
    }

    const url = new URL("https://api.getjobber.com/api/oauth/authorize");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("state", state);

    // Diagnostic: ?probe=1 checks whether Jobber accepts this client_id + redirect_uri
    // (client_id is public — it appears in the authorize URL — so it is safe to echo).
    if (new URL(req.url).searchParams.get("probe") === "1") {
      let status = 0;
      let location = "";
      let bodySnippet = "";
      try {
        const r = await fetch(url.toString(), { redirect: "manual" });
        status = r.status;
        location = r.headers.get("location") ?? "";
        bodySnippet = (await r.text()).slice(0, 400);
      } catch (e) {
        bodySnippet = String(e);
      }
      return json({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scopes: SCOPES,
        jobber_status: status,
        jobber_location: location,
        jobber_body_snippet: bodySnippet,
      });
    }

    return json({ authorize_url: url.toString() });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// Texts and emails Mark once per company on the waitlist (JOBBER_WAITLIST_MESSAGE promises they'll be contacted).
// Sandbox and demo companies only log (tcNotify's guard) and claim nothing. The claim (jobber_waitlist.alerted_at) is
// taken before sending and let go only when neither went out, so the next press tries again. Never throws: the
// company sees the message either way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function alertMark(admin: any, ownerId: string, claim: { used?: number; max?: number } | null) {
  try {
    const places = { used: claim?.used, max: claim?.max };
    const ctx = await notifyCtx(admin, ownerId, "jobber-connect");
    if (ctx.quiet) {
      const quietMail = waitlistAlertEmail(places);
      await sendSms(ADMIN_PHONE, waitlistAlertText(places), { ...ctx, kind: "JW1", role: "admin" });
      await sendEmail(ADMIN_EMAIL, quietMail.subject, quietMail.html, { ...ctx, kind: "JW1", role: "admin" });
      return;
    }
    const { data: claimed, error: claimError } = await admin
      .from("jobber_waitlist").update({ alerted_at: new Date().toISOString() })
      .eq("owner_id", ownerId).is("alerted_at", null).select("owner_id");
    if (claimError) throw new Error(`alert claim failed: ${claimError.message}`);
    if (!claimed || claimed.length === 0) return;

    const { data: profile } = await admin
      .from("profiles").select("full_name, company_name, phone, email").eq("id", ownerId).maybeSingle();
    const company = { ...places, company: profile?.company_name, owner: profile?.full_name, phone: profile?.phone, email: profile?.email };
    const mail = waitlistAlertEmail(company);
    const [texted, emailed] = await Promise.all([
      sendSms(ADMIN_PHONE, waitlistAlertText(company), { ...ctx, kind: "JW1", role: "admin" }),
      sendEmail(ADMIN_EMAIL, mail.subject, mail.html, { ...ctx, kind: "JW1", role: "admin" }),
    ]);
    if (!texted && !emailed) await admin.from("jobber_waitlist").update({ alerted_at: null }).eq("owner_id", ownerId);
  } catch (e) {
    console.error("[jobber-connect] waitlist alert failed", String((e as Error)?.message ?? e).slice(0, 200));
  }
}
