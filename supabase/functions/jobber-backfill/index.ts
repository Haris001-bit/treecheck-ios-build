// One-time (re-runnable) backfill: pulls recent Jobber jobs + invoices into
// TreeCheck as leads + lead_closeouts, so the contractor sees their existing
// Jobber history in-app. Idempotent — matches on jobber_job_id / jobber_invoice_id, within the company.
// Reads Jobber on the current API version (PULSE_JOBBER_VERSION): the 2024-04-01 it used to pin no
// longer exists, so every run failed (2026-10-22).
import { createClient } from "npm:@supabase/supabase-js@2";
import { getJobberToken, jobberGraphql, JobberReconnectRequired, ownerIdOf, PULSE_JOBBER_VERSION } from "../_shared/jobber.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PAGE_SIZE = 50;
const MAX_PAGES = 10; // hard cap ~500 records per run

const JOBS_QUERY = `
  query TC_BackfillJobs($first: Int!, $after: String) {
    jobs(first: $first, after: $after, sort: {key: CREATED_AT, direction: DESCENDING}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        jobNumber
        title
        jobStatus
        total
        createdAt
        completedAt
        client {
          id
          firstName
          lastName
          companyName
          phones { number }
          emails { address }
          billingAddress { street1 city province postalCode }
        }
        invoices(first: 1) {
          nodes { id invoiceNumber invoiceStatus amounts { total } }
        }
      }
    }
  }`;

function fullName(c: any) {
  const n = [c?.firstName, c?.lastName].filter(Boolean).join(" ").trim();
  return n || c?.companyName || "Homeowner";
}

async function upsertFromJob(admin: any, contractorId: string, job: any) {
  const client = job.client || {};
  const addr = client.billingAddress || {};
  const phone = client.phones?.[0]?.number || null;
  const email = client.emails?.[0]?.address || null;
  const invoice = job.invoices?.nodes?.[0] || null;

  // 1. Find or create the lead (by jobber_job_id, then jobber_client_id).
  let { data: lead } = await admin.from("leads").select("*")
    .eq("owner_contractor_id", contractorId)
    .eq("jobber_job_id", job.id).maybeSingle();
  if (!lead && client.id) {
    const { data: byClient } = await admin.from("leads").select("*")
      .eq("owner_contractor_id", contractorId)
      .eq("jobber_client_id", client.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    lead = byClient;
  }

  if (!lead) {
    const { data: newLead, error: leadErr } = await admin.from("leads").insert({
      source: "jobber",
      status: "sold_out",
      customer_name: fullName(client),
      customer_phone: phone,
      customer_email: email,
      // leads has no state or zip column (any more), so they follow the street: "12 Oak St, OK 73034".
      customer_address: [addr.street1, [addr.province, addr.postalCode].filter(Boolean).join(" ")]
        .filter(Boolean).join(", ") || null,
      city: addr.city || null,
      job_type: "Tree Removal",
      urgency: "normal",
      owner_contractor_id: contractorId,
      jobber_client_id: client.id || null,
      jobber_job_id: job.id,
      jobber_invoice_id: invoice?.id || null,
      purchase_count: 1,
    }).select().single();
    if (leadErr) throw new Error("lead insert: " + leadErr.message);
    lead = newLead;
  } else if (!lead.jobber_job_id) {
    await admin.from("leads").update({
      jobber_job_id: job.id,
      jobber_invoice_id: invoice?.id || lead.jobber_invoice_id,
    }).eq("id", lead.id);
  }

  // 2. Ensure a lead_purchase row exists for this contractor.
  let { data: purchase } = await admin.from("lead_purchases").select("*")
    .eq("lead_id", lead.id).eq("contractor_id", contractorId).maybeSingle();
  if (!purchase) {
    const { data: p, error: pErr } = await admin.from("lead_purchases").insert({
      lead_id: lead.id, contractor_id: contractorId, purchase_amount: 0,
    }).select().single();
    if (pErr) throw new Error("purchase insert: " + pErr.message);
    purchase = p;
  }

  // 3. Upsert a closeout for this job.
  // Jobber's job statuses have no "complete": a done job has completedAt, or waits for an invoice, or is archived.
  const status = String(job.jobStatus || "").toLowerCase();
  const isComplete = !!job.completedAt || status === "requires_invoicing" || status === "archived";
  const amount = Number(invoice?.amounts?.total ?? job.total ?? 0);
  const isPaid = String(invoice?.invoiceStatus || "").toLowerCase().includes("paid");

  const closeoutFields: any = {
    jobber_job_id: job.id,
    jobber_client_id: client.id || null,
    jobber_invoice_id: invoice?.id || null,
    jobber_invoice_number: invoice?.invoiceNumber || null,
    jobber_sync_status: isPaid ? "paid" : (invoice ? "synced" : "job_only"),
    jobber_synced_at: new Date().toISOString(),
    sale_amount: amount,
  };

  const { data: existing } = await admin.from("lead_closeouts").select("id, sale_amount")
    .eq("contractor_id", contractorId)
    .eq("jobber_job_id", job.id).maybeSingle();

  if (existing) {
    if (existing.sale_amount && amount === 0) delete closeoutFields.sale_amount;
    await admin.from("lead_closeouts").update(closeoutFields).eq("id", existing.id);
    return "updated";
  }

  if (!isComplete && !invoice) return "skipped_open";

  await admin.from("lead_closeouts").insert({
    purchase_id: purchase!.id,
    lead_id: lead.id,
    contractor_id: contractorId,
    notes: job.title ? `Imported from Jobber: ${job.title}` : "Imported from Jobber",
    source_origin: "jobber",
    ...closeoutFields,
  });
  return "created";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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

    const admin = createClient(SUPABASE_URL, SERVICE);
    // Jobber is connected per company (owner); a team member uses the owner's connection.
    const ownerId = await ownerIdOf(admin, u.user.id);
    const token = await getJobberToken(admin, ownerId);
    // Messages come back with status 200 so the page can show them (the client hides non-2xx bodies).
    if (!token) return json({ error: "Jobber isn't connected. Press Connect Jobber first." });

    let after: string | null = null;
    let pages = 0;
    const counts = { created: 0, updated: 0, skipped_open: 0, errors: 0 };

    while (pages < MAX_PAGES) {
      const data: any = await jobberGraphql(token, JOBS_QUERY, { first: PAGE_SIZE, after }, PULSE_JOBBER_VERSION);
      const conn = data.jobs;
      for (const job of conn.nodes || []) {
        try {
          const r = await upsertFromJob(admin, ownerId, job);
          (counts as any)[r]++;
        } catch (e) {
          console.error("[backfill] job failed", job.id, e);
          counts.errors++;
        }
      }
      pages++;
      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }

    return json({ ok: true, pages, ...counts });
  } catch (e) {
    if (e instanceof JobberReconnectRequired) {
      return json({ error: "Jobber needs to be reconnected. Press Reconnect Jobber, then sync again." });
    }
    console.error("jobber-backfill error", String((e as Error)?.message ?? e).slice(0, 500));
    return json({ error: "Couldn't read your Jobber jobs. Please try again in a minute." });
  }
});
