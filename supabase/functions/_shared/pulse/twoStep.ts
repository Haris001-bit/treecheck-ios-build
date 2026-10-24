// Financial Pulse: two-step sign-in before bank linking (Plaid security review, 2026-10-23).
//
// An owner must finish two-step sign-in (the 6-digit code from an authenticator app) in the current
// session before Plaid Link opens (plaid-link-token) or a new bank is saved (plaid-exchange).
// Supabase Auth writes the session's level into the access token's "aal" claim: "aal1" after a
// password, "aal2" after the code. Signing in and the rest of the app don't ask for the code.
// Pure code: the edge functions and the web app both import it.

export const TWO_STEP_CODE = "mfa_required";
export const TWO_STEP_MESSAGE =
  "Two-step sign-in is needed to link a bank. Press the button again and enter the 6-digit code from your authenticator app.";

/**
 * The "aal" claim of an Authorization header's bearer token, or null when it can't be read.
 * This only decodes the token: trust the result only after the token itself was verified
 * (callerOf checks it with Supabase Auth first).
 */
export function sessionLevel(authorization: string | null | undefined): string | null {
  const token = (authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!claims || typeof claims !== "object") return null;
    const aal = (claims as Record<string, unknown>).aal;
    return typeof aal === "string" ? aal : null;
  } catch {
    return null;
  }
}

/** True when the caller's session finished two-step sign-in. */
export function hasTwoStep(authorization: string | null | undefined): boolean {
  return sessionLevel(authorization) === "aal2";
}
