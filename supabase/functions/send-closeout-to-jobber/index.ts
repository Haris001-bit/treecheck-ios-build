// Syncs a lead closeout to Jobber: finds or creates the customer's client and creates a draft invoice
// for the office to send. Jobber's API has no way to email an invoice, so nothing is sent from here.
// Runs only when the company's closeout_invoices switch is on (company_jobber_settings), and only for
// leads created after that row was made: the office may already have invoiced an older one in Jobber.
// One invoice per closeout: the closeout is claimed ("syncing") before anything is sent to Jobber, and
// "uncertain" (Jobber may have made it without confirming) is never retried by TreeCheck.
// Jobber calls go through TreeCheck's Jobber modules (_shared/jobberInvoice.ts, API version 2026-09-25).
import { createClient } from "npm:@supabase/supabase-js@2";
import { getJobberToken, ownerIdOf } from "../_shared/jobber.ts";
import { JobberUncertainError, shortJobberError } from "../_shared/jobberApi.ts";
import { jobberSwitches } from "../_shared/jobberSwitches.ts";
import { parseUsAddress } from "../_shared/jobberAddress.ts";
import { createCloseoutInvoice } from "../_shared/jobberInvoice.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UNCERTAIN_TEXT = "Jobber may have made the invoice but didn't confirm it. Check Jobber before trying again.";
const CLAIM_STALE_MS = 5 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // Kept for the error path (the request body can only be read once), and set only for the caller's own closeout.
  let closeoutId: string | null = null;
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Unauthorized" }, 401);

    const { closeout_id } = await req.json().catch(() => ({}));
    if (!closeout_id) return json({ error: "closeout_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: closeout, error: coErr } = await admin
      .from("lead_closeouts").select("*").eq("id", closeout_id).maybeSingle();
    if (coErr || !closeout) return json({ error: "Closeout not found" }, 404);

    const { data: lead } = await admin
      .from("leads").select("*").eq("id", closeout.lead_id).maybeSingle();
    if (!lead) return json({ error: "Lead not found" }, 404);

    // The closeout must belong to the caller's company, and only that company's own Jobber
    // connection is used (never another company's).
    const callerOwner = await ownerIdOf(admin, u.user.id);
    const closeoutOwner = await ownerIdOf(admin, closeout.contractor_id);
    if (closeoutOwner !== callerOwner) return json({ error: "Closeout not found" }, 404);
    closeoutId = String(closeout_id);

    const token = await getJobberToken(admin, closeoutOwner);
    if (!token) {
      await admin.from("lead_closeouts").update({
        jobber_sync_status: "failed",
        jobber_sync_error: "Jobber not connected. Visit Integrations to connect.",
      }).eq("id", closeout_id);
      return json({ error: "Jobber not connected. Visit Integrations to connect." }, 400);
    }

    const switches = await jobberSwitches(admin, closeoutOwner);
    if (!switches.closeoutInvoices) {
      await admin.from("lead_closeouts").update({
        jobber_sync_status: "skipped",
        jobber_sync_error: null,
      }).eq("id", closeout_id);
      return json({ skipped: true, reason: "closeout_invoices_off" });
    }

    // Already made for this closeout: report it rather than making a second one.
    if (closeout.jobber_invoice_id) {
      return json({
        success: true,
        client_id: closeout.jobber_client_id ?? null,
        invoice_id: closeout.jobber_invoice_id,
        invoice_number: closeout.jobber_invoice_number ?? null,
        invoice_sent: false,
        invoice_draft: true,
      });
    }

    // A lead from before the company's Jobber switch row was made stays as it was.
    const { data: settings } = await admin
      .from("company_jobber_settings").select("created_at").eq("contractor_id", closeoutOwner).maybeSingle();
    const switchedOn = Date.parse(String(settings?.created_at ?? ""));
    const leadCreated = Date.parse(String(lead.created_at ?? ""));
    if (!Number.isFinite(switchedOn) || !Number.isFinite(leadCreated) || leadCreated < switchedOn) {
      await admin.from("lead_closeouts").update({
        jobber_sync_status: "skipped",
        jobber_sync_error: null,
      }).eq("id", closeout_id);
      return json({ skipped: true, reason: "lead_before_jobber_sync" });
    }

    // Claim the closeout, unless another call is making its invoice or Jobber may already have one.
    const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
    const { data: claimed, error: claimError } = await admin
      .from("lead_closeouts")
      .update({ jobber_sync_status: "syncing", jobber_sync_error: null })
      .eq("id", closeout_id)
      .is("jobber_invoice_id", null)
      .or(`jobber_sync_status.not.in.(syncing,uncertain),and(jobber_sync_status.eq.syncing,updated_at.lt.${staleBefore})`)
      .select("id");
    if (claimError) throw new Error("TreeCheck couldn't save the invoice's progress.");
    if (!claimed?.length) {
      const { data: latest } = await admin
        .from("lead_closeouts")
        .select("jobber_client_id, jobber_invoice_id, jobber_invoice_number, jobber_sync_status")
        .eq("id", closeout_id).maybeSingle();
      if (latest?.jobber_invoice_id) {
        return json({
          success: true,
          client_id: latest.jobber_client_id ?? null,
          invoice_id: latest.jobber_invoice_id,
          invoice_number: latest.jobber_invoice_number ?? null,
          invoice_sent: false,
          invoice_draft: true,
        });
      }
      if (latest?.jobber_sync_status === "uncertain") return json({ error: UNCERTAIN_TEXT });
      return json({ skipped: true, reason: "in_progress" });
    }

    const notes = String(closeout.notes ?? "").trim();
    const invoice = await createCloseoutInvoice(token, {
      customer: {
        name: lead.customer_name ?? null,
        email: lead.customer_email ?? null,
        phone: lead.customer_phone ?? null,
        address: parseUsAddress(lead.customer_address, { city: lead.city, defaultProvince: switches.defaultProvince }),
      },
      storedClientId: closeout.jobber_client_id ?? lead.jobber_client_id ?? null,
      service: lead.job_type || "Tree work",
      notes: notes || null,
      amount: Number(closeout.sale_amount),
      dueDate: new Date().toISOString(),
    });

    await admin.from("lead_closeouts").update({
      jobber_client_id: invoice.clientId,
      jobber_invoice_id: invoice.invoiceId,
      jobber_invoice_number: invoice.invoiceNumber,
      jobber_sync_status: "synced",
      jobber_sync_error: null,
      jobber_synced_at: new Date().toISOString(),
    }).eq("id", closeout_id);

    return json({
      success: true,
      client_id: invoice.clientId,
      invoice_id: invoice.invoiceId,
      invoice_number: invoice.invoiceNumber,
      invoice_sent: false,
      invoice_draft: true,
    });
  } catch (e) {
    const uncertain = e instanceof JobberUncertainError;
    const msg = uncertain ? UNCERTAIN_TEXT : shortJobberError(e);
    console.error("send-closeout-to-jobber error", msg);
    if (closeoutId) {
      try {
        const admin = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await admin.from("lead_closeouts").update({
          jobber_sync_status: uncertain ? "uncertain" : "failed",
          jobber_sync_error: msg,
        }).eq("id", closeoutId);
      } catch { /* ignore */ }
    }
    return json({ error: msg }, 500);
  }
});
