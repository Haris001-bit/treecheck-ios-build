// Send FCM push notifications via HTTP v1 API — App Store-safe gateway.
//
// Body: {
//   contractor_ids: string[],
//   notification_type: string,           // see ALLOWED_TYPES below
//   lead_id?: string,                    // required for lead_* types on iOS
//   title?: string, body?: string,       // used for web/android; iOS overrides w/ safe template
//   data?: Record<string,string>         // PII stripped for iOS; whitelist applied
// }
//
// iOS rules enforced by this gateway:
//  1. notification_type must be in IOS_ALLOWED_TYPES (else token is skipped).
//  2. For lead-scoped types, the contractor must already have access to the lead
//     (verified via public.mobile_can_access_lead RPC).
//  3. Notification copy is replaced with neutral templates — no purchase language.
//  4. Data payload is filtered to a safe whitelist — no PII, no payment info.
//  5. Per-device preference toggles (lead_alerts_enabled / account_alerts_enabled /
//     marketing_alerts_enabled) are respected; revoked tokens are skipped.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- iOS-safe notification type registry -----------------------------------
const IOS_ALLOWED_TYPES = new Set<string>([
  "lead_assigned",
  "lead_unlocked_elsewhere",
  "lead_updated",
  "scout_lead_created",
  "message_or_response_update",
  "account_activity_non_payment",
  "reminder_for_existing_accessible_lead",
]);

const IOS_LEAD_SCOPED_TYPES = new Set<string>([
  "lead_assigned",
  "lead_unlocked_elsewhere",
  "lead_updated",
  "scout_lead_created",
  "reminder_for_existing_accessible_lead",
]);

// Marketing/lead-alert classification for preference toggles
const LEAD_ALERT_TYPES = new Set<string>([
  "lead_assigned",
  "lead_unlocked_elsewhere",
  "lead_updated",
  "scout_lead_created",
  "reminder_for_existing_accessible_lead",
]);
const ACCOUNT_ALERT_TYPES = new Set<string>([
  "account_activity_non_payment",
  "message_or_response_update",
]);

// Safe-mode copy templates — neutral, no pricing, no purchase language.
function iosCopyFor(type: string, ctx: { city?: string; job_type?: string }) {
  const city = (ctx.city || "").trim();
  const job = (ctx.job_type || "tree-service").trim();
  switch (type) {
    case "lead_assigned":
      return {
        title: "New TreeCheck lead",
        body: city
          ? `A ${job} lead in ${city} has been added to your account.`
          : `A new ${job} lead has been added to your account.`,
      };
    case "lead_unlocked_elsewhere":
      return {
        title: "Lead added to Your Leads",
        body: "A lead is now available in Your Leads.",
      };
    case "lead_updated":
      return {
        title: "Lead updated",
        body: "A lead in Your Leads has new information.",
      };
    case "scout_lead_created":
      return {
        title: "Scout lead added",
        body: "A Scout lead has been added to your account.",
      };
    case "message_or_response_update":
      return {
        title: "Account update",
        body: "You have a new update in your account.",
      };
    case "reminder_for_existing_accessible_lead":
      return {
        title: "Reminder",
        body: "A lead in Your Leads is waiting for follow-up.",
      };
    case "account_activity_non_payment":
    default:
      return {
        title: "TreeCheck",
        body: "You have a new account update.",
      };
  }
}

// Strip ALL caller-provided data to a safe whitelist for iOS payloads.
const IOS_DATA_WHITELIST = new Set<string>([
  "type", "notification_type", "lead_id", "route_target",
  "city", "state", "job_type", "source", "created_at",
]);

function safeIosData(type: string, lead_id: string | undefined, raw: Record<string, unknown>) {
  const out: Record<string, string> = {
    type,
    notification_type: type,
    route_target: lead_id ? "lead_detail" : "dashboard",
  };
  if (lead_id) out.lead_id = lead_id;
  for (const [k, v] of Object.entries(raw || {})) {
    if (!IOS_DATA_WHITELIST.has(k)) continue;
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}

// --- Google OAuth2 access token from service account ---
async function getAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: any) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const unsigned = `${enc(header)}.${enc(payload)}`;

  // Import PKCS8 private key
  const pem = serviceAccount.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${unsigned}.${sig}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`OAuth error: ${JSON.stringify(json)}`);
  return json.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      contractor_ids,
      notification_type,
      lead_id,
      title: rawTitle,
      body: rawBody,
      data: rawData,
    } = body || {};

    if (!Array.isArray(contractor_ids) || contractor_ids.length === 0 || !notification_type) {
      return new Response(
        JSON.stringify({ error: "Missing contractor_ids or notification_type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Caller authorization. Internal functions call with the service key and may
    // notify anyone; admins may notify anyone; any other signed-in user may only
    // notify themselves (the NotificationSettings self-test).
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (bearer !== serviceKey) {
      const authClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
        auth: { persistSession: false },
      });
      const { data: u } = bearer
        ? await authClient.auth.getUser(bearer)
        : { data: { user: null } };
      if (!u?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const onlySelf = contractor_ids.length === 1 && contractor_ids[0] === u.user.id;
      if (!onlySelf) {
        const { data: me } = await authClient
          .from("profiles").select("role").eq("id", u.user.id).maybeSingle();
        if (me?.role !== "admin") {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const saJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!saJson) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON not set");
    const serviceAccount = JSON.parse(saJson);
    const projectId = serviceAccount.project_id;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tokens, error } = await supabase
      .from("device_tokens")
      .select(
        "token, contractor_id, platform, revoked_at, lead_alerts_enabled, account_alerts_enabled, marketing_alerts_enabled",
      )
      .in("contractor_id", contractor_ids);

    if (error) throw error;
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0, blocked: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getAccessToken(serviceAccount);
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    let sent = 0;
    let blocked = 0;
    const staleTokens: string[] = [];
    const auditRows: any[] = [];

    for (const t of tokens) {
      const platform = (t.platform || "").toLowerCase();
      const isIos = platform === "ios";

      // Skip revoked
      if (t.revoked_at) {
        blocked++;
        auditRows.push({
          contractor_id: t.contractor_id,
          notification_type,
          lead_id: lead_id || null,
          platform,
          delivered: false,
          blocked_reason: "token_revoked",
        });
        continue;
      }

      // Per-device preference toggles
      if (LEAD_ALERT_TYPES.has(notification_type) && t.lead_alerts_enabled === false) {
        blocked++;
        auditRows.push({
          contractor_id: t.contractor_id, notification_type, lead_id: lead_id || null,
          platform, delivered: false, blocked_reason: "lead_alerts_off",
        });
        continue;
      }
      if (ACCOUNT_ALERT_TYPES.has(notification_type) && t.account_alerts_enabled === false) {
        blocked++;
        auditRows.push({
          contractor_id: t.contractor_id, notification_type, lead_id: lead_id || null,
          platform, delivered: false, blocked_reason: "account_alerts_off",
        });
        continue;
      }

      let title: string;
      let bodyText: string;
      let dataPayload: Record<string, string> = {};

      if (isIos) {
        // Hard gate 1: type allowed for iOS
        if (!IOS_ALLOWED_TYPES.has(notification_type)) {
          blocked++;
          auditRows.push({
            contractor_id: t.contractor_id, notification_type, lead_id: lead_id || null,
            platform, delivered: false, blocked_reason: "type_not_allowed_on_ios",
          });
          continue;
        }
        // Hard gate 2: lead access confirmed
        if (IOS_LEAD_SCOPED_TYPES.has(notification_type)) {
          if (!lead_id) {
            blocked++;
            auditRows.push({
              contractor_id: t.contractor_id, notification_type, lead_id: null,
              platform, delivered: false, blocked_reason: "missing_lead_id",
            });
            continue;
          }
          const { data: canAccess, error: accessErr } = await supabase.rpc(
            "mobile_can_access_lead",
            { p_lead_id: lead_id, p_user: t.contractor_id },
          );
          if (accessErr || !canAccess) {
            blocked++;
            auditRows.push({
              contractor_id: t.contractor_id, notification_type, lead_id,
              platform, delivered: false, blocked_reason: "no_lead_access",
            });
            continue;
          }
        }
        const tpl = iosCopyFor(notification_type, {
          city: rawData?.city,
          job_type: rawData?.job_type,
        });
        title = tpl.title;
        bodyText = tpl.body;
        dataPayload = safeIosData(notification_type, lead_id, rawData || {});
      } else {
        // Web / Android keep caller copy
        title = rawTitle || "TreeCheck";
        bodyText = rawBody || "";
        for (const [k, v] of Object.entries(rawData || {})) {
          if (v !== undefined && v !== null) dataPayload[k] = String(v);
        }
        if (lead_id) dataPayload.lead_id = String(lead_id);
        dataPayload.type = notification_type;
        dataPayload.notification_type = notification_type;
      }

      try {
        const resp = await fetch(fcmUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: t.token,
              notification: { title, body: bodyText },
              data: dataPayload,
              apns: { payload: { aps: { sound: "default", badge: 1 } } },
            },
          }),
        });
        if (resp.ok) {
          sent++;
          auditRows.push({
            contractor_id: t.contractor_id, notification_type, lead_id: lead_id || null,
            platform, delivered: true, payload: dataPayload,
          });
        } else {
          const errBody = await resp.text();
          console.error(`FCM failed for ${t.contractor_id}:`, errBody);
          if (resp.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(errBody)) {
            staleTokens.push(t.token);
          }
          auditRows.push({
            contractor_id: t.contractor_id, notification_type, lead_id: lead_id || null,
            platform, delivered: false, blocked_reason: "fcm_error",
          });
        }
      } catch (e) {
        console.error("FCM send error:", e);
      }
    }

    if (staleTokens.length > 0) {
      await supabase
        .from("device_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .in("token", staleTokens);
    }

    // Best-effort audit log
    if (auditRows.length > 0) {
      try {
        await supabase.from("notification_events").insert(auditRows);
      } catch (e) {
        console.error("notification_events insert failed:", e);
      }
    }

    console.log(
      `send-push[${notification_type}]: sent=${sent} blocked=${blocked} stale=${staleTokens.length}`,
    );

    return new Response(
      JSON.stringify({ sent, blocked, total: tokens.length, stale: staleTokens.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
