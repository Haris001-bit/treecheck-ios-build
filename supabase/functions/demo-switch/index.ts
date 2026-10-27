// Event demo (milestone 2): the one-tap switch between demo logins. It hands the caller a one-time sign-in for another
// demo login (a Supabase magic-link token; no email is sent), so the app holds no password and never signs out. Only the
// demo logins can use it, only to open another demo login, and only while both are sandbox companies.
// With no "to" (the 1.2 phone apps), it opens the other half of the Timber demo pair as before; with "to" (the picker,
// 2026-10-26), it opens that demo login, which includes the large-company demo's owner and crew leader.
// Maintained outside Lovable.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { DEMO_EMAILS, DEMO_LOGINS, demoLoginIds, otherDemoLogin } from "../_shared/demoCompany.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: u } = token ? await admin.auth.getUser(token) : { data: null };
    if (!u?.user) return json({ error: "Please sign in again." }, 401);
    const body = await req.json().catch(() => ({})) as { to?: unknown };
    const to = typeof body?.to === "string" ? body.to : null;

    // Refusals answer 200 with an error, so the app can show the reason.
    let other: { id: string; open: string } | null;
    if (to) {
      const { data: found } = await admin.from("profiles").select("id, email").in("email", DEMO_EMAILS);
      const ids = demoLoginIds((found ?? []) as { id: string; email: string | null }[]);
      if (![...ids.values()].includes(u.user.id)) return json({ error: "Only the demo logins can switch." });
      const login = DEMO_LOGINS.find((l) => l.key === to);
      const id = login ? ids.get(login.key) : undefined;
      if (!login || !id) return json({ error: "That demo login isn't set up yet." });
      if (id === u.user.id) return json({ error: "You're already signed in as that demo login." });
      other = { id, open: login.open };
    } else {
      other = otherDemoLogin(u.user.id);
      if (!other) return json({ error: "Only the demo logins can switch." });
    }
    const { data: pair } = await admin.from("profiles").select("id, is_sandbox").in("id", [u.user.id, other.id]);
    const rows = (pair ?? []) as { id: string; is_sandbox?: boolean }[];
    if (rows.length !== 2 || !rows.every((p) => p.is_sandbox === true)) return json({ error: "The demo isn't set up yet." });

    const { data: target } = await admin.auth.admin.getUserById(other.id);
    const email = target?.user?.email;
    if (!email) return json({ error: "The demo isn't set up yet." });
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("demo-switch: no sign-in link", error?.message ?? "no token");
      return json({ error: "Couldn't switch. Try again." });
    }
    return json({ token_hash: tokenHash, open: other.open });
  } catch (e) {
    console.error("demo-switch", e instanceof Error ? e.message : e);
    return json({ error: "Couldn't switch. Try again." }, 500);
  }
});
