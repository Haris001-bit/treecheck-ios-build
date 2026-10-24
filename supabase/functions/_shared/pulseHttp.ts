// Financial Pulse: shared request handling for the Pulse edge functions.
//
// Caller kinds (A5):
// * service: the bearer token is the service-role key (internal calls only).
// * owner: a signed-in user for whom pulse_owner_id() returns their own id (a company owner with
//   Pulse switched on). The owner id always comes from the database, never from the request body.
// * admin: a signed-in user whose profile role is 'admin' (Mark's switch page). Admins never read
//   finance rows through this; admin functions return no money fields.
// Expected failures come back as HTTP 200 with {ok: false, code, error}, because the web client hides
// the body of non-2xx responses.

import { createClient } from "npm:@supabase/supabase-js@2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Admin = any;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const fail = (code: string, error: string, extra: Record<string, unknown> = {}) => json({ ...extra, ok: false, code, error });

export function adminClient(): Admin {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export type Caller =
  | { kind: "service" }
  | { kind: "user"; userId: string; ownerId: string | null; isAdmin: boolean };

/** Works out who is calling. Null when there is no valid caller. */
export async function callerOf(req: Request, admin: Admin): Promise<Caller | null> {
  const header = req.headers.get("Authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return null;
  if (bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return { kind: "service" };

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return null;
  const [{ data: ownerId }, { data: prof }] = await Promise.all([
    userClient.rpc("pulse_owner_id"),
    admin.from("profiles").select("role").eq("id", u.user.id).maybeSingle(),
  ]);
  return {
    kind: "user",
    userId: u.user.id,
    ownerId: typeof ownerId === "string" ? ownerId : null,
    isAdmin: prof?.role === "admin",
  };
}

/** Runs work after the reply when the runtime supports it; otherwise waits for it. */
export async function afterReply(work: Promise<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(work.catch((e: unknown) => console.error("[pulse] background task failed", String((e as Error)?.message ?? e))));
    return;
  }
  await work.catch((e: unknown) => console.error("[pulse] task failed", String((e as Error)?.message ?? e)));
}

/** Reads a JSON body; an unreadable body is an empty object. */
export async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => ({}));
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}
