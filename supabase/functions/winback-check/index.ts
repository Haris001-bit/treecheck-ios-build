import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[WINBACK-CHECK] ${step}${detailsStr}`);
};

const WINBACK_TIERS = [
  { days: 14, credits: 10, reasonCode: 'win_back_14', field: 'winback_14d_sent_at' },
  { days: 30, credits: 15, reasonCode: 'win_back_30', field: 'winback_30d_sent_at' },
  { days: 60, credits: 20, reasonCode: 'win_back_60', field: 'winback_60d_sent_at' },
] as const;

const SMS_MESSAGES: Record<string, (firstName: string) => string> = {
  win_back_14: (name) =>
    `${name}, there are active leads in your area right now. We've added $10 in credits to your account — don't let them go to a competitor.`,
  win_back_30: (name) =>
    `${name}, it's been a month. We're holding $15 in credits in your account for the next job in your zone. They expire in 7 days.`,
  win_back_60: (name) =>
    `${name}, we miss having you in the mix. Here's $20 in credits on us — homeowners in your area requested quotes this week. Tap to see them.`,
};

// Normalize phone to E.164
const normalizePhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.trim().startsWith("+")) return phone.trim();
  return `+1${digits}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Get all active contractors with their engagement data
    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone, credit_balance, is_active")
      .eq("is_active", true);

    if (profErr) throw profErr;
    if (!profiles || profiles.length === 0) {
      logStep("No active profiles found");
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get engagement records
    const { data: engagements } = await supabaseAdmin
      .from("contractor_engagement")
      .select("*");

    const engagementMap = new Map(
      (engagements || []).map((e: any) => [e.contractor_id, e])
    );

    // Check which contractors have purchased at least 1 lead in the last 60 days
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentPurchasers } = await supabaseAdmin
      .from("lead_purchases")
      .select("contractor_id")
      .gte("purchased_at", sixtyDaysAgo);

    const qualifiedContractors = new Set(
      (recentPurchasers || []).map((p: any) => p.contractor_id)
    );

    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const fromNumber = Deno.env.get("TWILIO_PHONE_NUMBER");
    const canSendSms = !!(accountSid && authToken && fromNumber);

    let creditsAwarded = 0;
    let smsSent = 0;
    let flaggedForOutreach = 0;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    for (const profile of profiles) {
      // Must have at least 1 purchase in last 60 days to qualify
      if (!qualifiedContractors.has(profile.id)) continue;

      let engagement = engagementMap.get(profile.id) as any;

      // If no engagement record, check their last purchase
      if (!engagement) {
        const { data: lastPurchase } = await supabaseAdmin
          .from("lead_purchases")
          .select("purchased_at")
          .eq("contractor_id", profile.id)
          .order("purchased_at", { ascending: false })
          .limit(1)
          .single();

        if (!lastPurchase) continue;

        // Create engagement record
        await supabaseAdmin.from("contractor_engagement").insert({
          contractor_id: profile.id,
          last_purchase_at: lastPurchase.purchased_at,
        });

        engagement = {
          contractor_id: profile.id,
          last_purchase_at: lastPurchase.purchased_at,
          winback_7d_sent_at: null,
          winback_14d_sent_at: null,
          winback_30d_sent_at: null,
          cycle_count: 0,
          flagged_for_outreach: false,
        };
      }

      if (engagement.flagged_for_outreach) continue;

      const lastActivity = new Date(engagement.last_purchase_at);
      const idleDays = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24);

      // Check if 2 full cycles completed with no activity → flag for outreach
      if (engagement.cycle_count >= 2) {
        await supabaseAdmin
          .from("contractor_engagement")
          .update({ flagged_for_outreach: true, updated_at: now.toISOString() })
          .eq("contractor_id", profile.id);
        flaggedForOutreach++;
        logStep("Flagged for outreach", { contractorId: profile.id, cycles: engagement.cycle_count });
        continue;
      }

      // Check each tier
      for (const tier of WINBACK_TIERS) {
        if (idleDays < tier.days) continue;

        const sentField = tier.field as string;
        if (engagement[sentField]) continue; // Already sent this tier in current cycle

        logStep("Awarding win-back credits", {
          contractorId: profile.id,
          tier: tier.reasonCode,
          credits: tier.credits,
          idleDays: Math.floor(idleDays),
        });

        // Add credits to profile
        await supabaseAdmin
          .from("profiles")
          .update({ credit_balance: (profile.credit_balance || 0) + tier.credits })
          .eq("id", profile.id);

        // Record transaction with expiration
        await supabaseAdmin.from("credit_transactions").insert({
          contractor_id: profile.id,
          amount: tier.credits,
          type: "win_back",
          reason_code: tier.reasonCode,
          description: `Win-back: $${tier.credits} credits (${tier.days}-day idle)`,
          expires_at: expiresAt,
        });

        // Update engagement tracking
        const updateData: Record<string, any> = {
          [sentField]: now.toISOString(),
          updated_at: now.toISOString(),
        };

        // If this is the 30-day tier, increment cycle count
        if (tier.days === 30) {
          updateData.cycle_count = (engagement.cycle_count || 0) + 1;
        }

        await supabaseAdmin
          .from("contractor_engagement")
          .update(updateData)
          .eq("contractor_id", profile.id);

        creditsAwarded += tier.credits;

        // Send SMS
        if (canSendSms && profile.phone) {
          try {
            const firstName = (profile.full_name || "").split(" ")[0] || "Hey";
            const messageGen = SMS_MESSAGES[tier.reasonCode];
            const message = messageGen(firstName);
            const toNumber = normalizePhone(profile.phone);

            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
            const resp = await fetch(twilioUrl, {
              method: "POST",
              headers: {
                Authorization: "Basic " + btoa(`${accountSid}:${authToken}`),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                To: toNumber,
                From: fromNumber!,
                Body: message,
              }),
            });

            if (resp.ok) {
              smsSent++;
              logStep("SMS sent", { contractorId: profile.id, tier: tier.reasonCode });
            } else {
              const errBody = await resp.text();
              logStep("SMS failed", { contractorId: profile.id, error: errBody });
            }
          } catch (smsErr) {
            logStep("SMS error", { contractorId: profile.id, error: String(smsErr) });
          }
        }

        // Native push for the free credits
        try {
          await supabaseAdmin.functions.invoke("send-push", {
            body: {
              contractor_ids: [profile.id],
              // Purchase-oriented copy — gateway will drop this for iOS tokens.
              notification_type: "account_activity_non_payment",
              title: `🎁 $${tier.credits} Free Credits`,
              body: `We added $${tier.credits} to your account — claim a lead today!`,
              data: { type: "winback", reason: tier.reasonCode },
            },
          });

        } catch (pushErr) {
          logStep("Push error", { contractorId: profile.id, error: String(pushErr) });
        }

        // Only award the highest applicable tier per run
        break;
      }
    }

    logStep("Completed", { creditsAwarded, smsSent, flaggedForOutreach });

    return new Response(
      JSON.stringify({ creditsAwarded, smsSent, flaggedForOutreach }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
