// Financial Pulse admin page (Mark): calls the pulse-admin edge function.
// Expected failures come back as HTTP 200 { ok: false, code, error }; anything else is a network failure.
import { supabase } from "@/integrations/supabase/client";

export type PlaidEnv = "sandbox" | "production";

export interface AdminBank {
  plaid_env: PlaidEnv;
  institution_name: string | null;
  status: string;
  last_successful_update: string | null;
}

export interface AdminCompany {
  owner_id: string;
  enabled: boolean;
  plaid_env: PlaidEnv;
  max_items: number;
  enabled_at: string | null;
  disabled_at: string | null;
  note: string | null;
  company: { id: string; company_name: string | null; full_name: string | null; email: string | null } | null;
  banks: AdminBank[];
}

export interface AdminHealth {
  secrets: Record<string, boolean>;
  token_keys: Record<PlaidEnv, { configured: boolean; works: boolean; stored_token_readable: boolean | null }>;
  /** cap and trial_limit are null when there is no TreeCheck-wide limit (Plaid's paid plan, from 2026-10-26). */
  production_connections: { used: number; cap: number | null; trial_limit: number | null };
  connections_needing_support: number;
  redirect_uri_set: boolean;
}

export interface FoundCompany {
  owner_id: string;
  company_name: string | null;
  full_name: string | null;
  email: string | null;
  access: { enabled: boolean; plaid_env: PlaidEnv; max_items: number } | null;
}

export type AdminFailure = { ok: false; code: string; error: string };
export type AdminResult<T> = ({ ok: true } & T) | AdminFailure;

/** True for an expected failure (narrows the result in loose TypeScript too). */
export function isAdminFailure<T>(r: AdminResult<T>): r is AdminFailure {
  return r.ok === false;
}

const GENERIC = "Something went wrong. Please try again.";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function call<T>(body: Record<string, unknown>): Promise<AdminResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke<unknown>("pulse-admin", { body });
    if (error) return { ok: false, code: "network", error: "Couldn't reach TreeCheck. Check your connection and try again." };
    const parsed: unknown = typeof data === "string" ? (() => { try { return JSON.parse(data) as unknown; } catch { return null; } })() : data;
    if (!isRecord(parsed) || typeof parsed.ok !== "boolean") return { ok: false, code: "network", error: GENERIC };
    if (!parsed.ok) {
      return {
        ok: false,
        code: typeof parsed.code === "string" && parsed.code ? parsed.code : "unknown",
        error: typeof parsed.error === "string" && parsed.error.trim() ? parsed.error.trim() : GENERIC,
      };
    }
    return parsed as unknown as AdminResult<T>;
  } catch {
    return { ok: false, code: "network", error: GENERIC };
  }
}

export const pulseAdminApi = {
  list: () => call<{ companies: AdminCompany[] }>({ action: "list" }),
  health: () => call<AdminHealth>({ action: "health" }),
  find: (email: string) => call<{ company: FoundCompany }>({ action: "find", email }),
  setAccess: (b: { owner_id: string; enabled: boolean; plaid_env?: PlaidEnv; max_items?: number }) =>
    call<Record<string, never>>({ action: "set_access", ...b }),
};

/** The name to show for a company: its company name, else the owner's name, else the email. */
export function companyName(c: { company_name?: string | null; full_name?: string | null; email?: string | null } | null): string {
  return c?.company_name?.trim() || c?.full_name?.trim() || c?.email?.trim() || "Unnamed company";
}
