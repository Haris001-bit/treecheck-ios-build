// Password reset email sent from TreeCheck's own Gmail with a TreeCheck-branded message, because the default
// auth sender wasn't reaching people (Hotmail) and must never show another brand. Always answers ok, so it never
// reveals whether an email has an account. At most one reset email per account per minute.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const APP_URL = "https://app.treecheck.ai";
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function b64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const connKey = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!apiKey || !connKey) return false;
  const mime = [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", html].join("\r\n");
  const res = await fetch("https://connector-gateway.lovable.dev/google_mail/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "X-Connection-Api-Key": connKey, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(mime) }),
  });
  if (!res.ok) console.error("send-password-reset: gmail", res.status, await res.text());
  return res.ok;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({})) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: profile } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (!profile) return json({ ok: true });

    const { data: u } = await admin.auth.admin.getUserById(profile.id);
    const last = u?.user?.recovery_sent_at ? new Date(u.user.recovery_sent_at).getTime() : 0;
    if (Date.now() - last < 60_000) return json({ ok: true });

    const { data: link, error } = await admin.auth.admin.generateLink({
      type: "recovery", email: u?.user?.email ?? email, options: { redirectTo: `${APP_URL}/reset-password` },
    });
    const url = link?.properties?.action_link;
    if (error || !url) {
      console.error("send-password-reset: no link", error?.message);
      return json({ ok: false, fallback: true });
    }
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
      <h2 style="color:#7a9b4d;margin:0 0 12px">Reset your TreeCheck password</h2>
      <p>Someone asked to reset the password for ${escapeHtml(email)}. Tap the button to choose a new one.</p>
      <p style="margin:24px 0"><a href="${url}" style="background:#7a9b4d;color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Choose a new password</a></p>
      <p style="font-size:14px">The link opens in your web browser and works once. After you save the new password, sign in to the TreeCheck app with it.</p>
      <p style="font-size:13px;color:#6b7280">Didn't ask for this? You can ignore this email; your password stays the same.</p>
    </div>`;
    const sent = await sendEmail(u?.user?.email ?? email, "Reset your TreeCheck password", html);
    return json(sent ? { ok: true } : { ok: false, fallback: true });
  } catch (e) {
    console.error("send-password-reset", e instanceof Error ? e.message : e);
    return json({ ok: false, fallback: true });
  }
});
