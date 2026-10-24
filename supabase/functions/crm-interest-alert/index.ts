// Texts and emails Mark when a company says it uses a CRM other than Jobber, so he can call them and get them set up (Mark,
// 2026-10-22). The owner's browser calls it after saving company setup. Nothing in the request is trusted: it reads
// the caller's own saved answer (company_settings) with the service role, stays quiet for sandbox and demo companies
// (tcNotify's guard), and alerts once per company and CRM (crm_interest_alerts, CR1: the key is claimed before the
// text and email go, so two quick calls never alert twice). Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { crmAlertEmail, crmAlertKey, crmAlertText, otherCrmName } from "../_shared/crmChoice.ts";
import { notifyCtx, sendEmail, sendSms } from "../_shared/tcNotify.ts";

// Mark's phone, the number notify-admin-transaction and reportIncident text.
const ADMIN_PHONE = "+13036693816";
// Mark's TreeCheck admin login (Haris, 2026-10-22), sent through the Gmail connection billing-reminders uses.
const ADMIN_EMAIL = "mark@tradesmarketing.ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ ok: false, error: "Unauthorized" }, 401);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

  try {
    const asCaller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    });
    const { data: who, error: whoError } = await asCaller.auth.getUser();
    const userId = who?.user?.id;
    if (whoError || !userId) return json({ ok: false, error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const { data: settings, error: settingsError } = await admin
      .from("company_settings").select("crm, crm_other").eq("contractor_id", userId).maybeSingle();
    if (settingsError) throw new Error(`settings read failed: ${settingsError.message}`);
    const crm = otherCrmName(settings?.crm, settings?.crm_other);
    const key = crmAlertKey(settings?.crm, settings?.crm_other);
    if (!crm || !key) return json({ ok: true, sent: false, reason: "no other crm" });

    // Sandbox and demo companies (and any company whose flag can't be read) never text or email Mark, and claim nothing.
    const ctx = await notifyCtx(admin, userId, "crm-interest-alert");
    if (ctx.quiet) {
      const quietMail = crmAlertEmail({ crm });
      await sendSms(ADMIN_PHONE, crmAlertText({ crm }), { ...ctx, kind: "CRM1", role: "admin" });
      await sendEmail(ADMIN_EMAIL, quietMail.subject, quietMail.html, { ...ctx, kind: "CRM1", role: "admin" });
      return json({ ok: true, sent: false, reason: "quiet company" });
    }

    const { data: claimed, error: claimError } = await admin
      .from("crm_interest_alerts")
      .upsert({ contractor_id: userId, crm_key: key }, { onConflict: "contractor_id,crm_key", ignoreDuplicates: true })
      .select("crm_key");
    if (claimError) throw new Error(`claim failed: ${claimError.message}`);
    if (!claimed || claimed.length === 0) return json({ ok: true, sent: false, reason: "already sent" });

    const { data: profile } = await admin
      .from("profiles").select("full_name, company_name, phone, email").eq("id", userId).maybeSingle();
    const signup = { crm, company: profile?.company_name, owner: profile?.full_name, phone: profile?.phone, email: profile?.email };
    const mail = crmAlertEmail(signup);
    const [texted, emailed] = await Promise.all([
      sendSms(ADMIN_PHONE, crmAlertText(signup), { ...ctx, kind: "CRM1", role: "admin" }),
      sendEmail(ADMIN_EMAIL, mail.subject, mail.html, { ...ctx, kind: "CRM1", role: "admin" }),
    ]);
    // Only when neither went out is the claim let go, so the owner's next save tries again; one that went is never repeated.
    if (!texted && !emailed) await admin.from("crm_interest_alerts").delete().eq("contractor_id", userId).eq("crm_key", key);
    return json({ ok: true, sent: texted || emailed, texted, emailed });
  } catch (e) {
    console.error("crm-interest-alert error", String((e as Error)?.message ?? e).slice(0, 200));
    return json({ ok: false, error: "Internal error" }, 500);
  }
});
