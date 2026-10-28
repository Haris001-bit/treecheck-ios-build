// A connect that TreeCheck refuses because another company already holds that Jobber account has still traded
// Jobber's code for a new sign-in, and Jobber's new sign-in cancels the one that company was using. Throwing it
// away disconnected Timber on 2026-10-27: a second try from another login at 12:55 UTC was refused, the old
// access key kept working until it expired, and the renewal was refused at 18:47 UTC. The new sign-in is for the
// same Jobber account, so it is saved to the company that holds it, which stays connected.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** What Jobber's token endpoint returns for an authorization code. */
export interface JobberGrant { access_token?: string; refresh_token?: string; expires_in?: number }

/**
 * Saves a refused connect's new sign-in to the company that holds that Jobber account (an active connection other
 * than the refused owner's). Returns that company's id, or null when there is none or the save failed. Never
 * throws: the refusal still goes back to the person connecting.
 */
export async function keepHolderConnected(
  admin: Admin, accountId: string, refusedOwner: string, grant: JobberGrant, accountName: string | null, now = Date.now(),
): Promise<string | null> {
  try {
    if (!grant.access_token || !grant.refresh_token) return null;
    const { data, error } = await admin
      .from("jobber_tokens").select("contractor_id")
      .eq("jobber_account_id", accountId).is("disconnected_at", null)
      .neq("contractor_id", refusedOwner).limit(1);
    const holder = !error && data && data.length > 0 ? (data[0].contractor_id as string) : null;
    if (!holder) return null;

    const patch: Record<string, unknown> = {
      access_token: grant.access_token,
      refresh_token: grant.refresh_token,
      expires_at: new Date(now + (grant.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date(now).toISOString(),
    };
    if (accountName) patch.account_name = accountName;
    // Only while that company still holds this account. A renewal running right now with the cancelled key is
    // refused by Jobber, and getJobberToken then re-reads the row and uses this sign-in.
    const { error: saveErr } = await admin
      .from("jobber_tokens").update(patch)
      .eq("contractor_id", holder).eq("jobber_account_id", accountId).is("disconnected_at", null);
    if (saveErr) {
      console.error("[jobber-oauth] could not keep the holding company connected", saveErr.message);
      return null;
    }
    console.log("[jobber-oauth] refused connect: the company holding this Jobber account keeps the new sign-in", holder);
    return holder;
  } catch (e) {
    console.error("[jobber-oauth] could not keep the holding company connected", (e as Error).message);
    return null;
  }
}
