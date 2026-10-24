// Onboarding milestone: the signup holes stay closed. These read the functions' source, so a later edit that
// brings a hole back fails the suite (same approach as src/lib/demo/offSwitch.test.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FUNCTIONS = join(process.cwd(), "supabase", "functions");
// Line endings normalised: a Windows checkout has CRLF, the repo has LF.
const source = (fn: string) => readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8").replace(/\r\n/g, "\n");

describe("subcontractor membership checkout", () => {
  const code = source("create-crew-checkout");
  it("works out the price on the server, never from the request", () => {
    expect(code).toContain("myCrewMarket(admin, ownerId)");
    expect(code).not.toContain("body.monthly_price");
  });
  it("answers free where membership costs nothing", () => {
    expect(code).toMatch(/monthlyPrice === 0\)[^\n]*free: true/);
  });
  it("never opens a second checkout while Stripe already has a membership", () => {
    const check = code.indexOf("stripe.subscriptions.list({ customer: customerId");
    expect(check).toBeGreaterThan(0);
    expect(code.indexOf("stripe.checkout.sessions.create(")).toBeGreaterThan(check);
  });
});

describe("stripe-webhook", () => {
  it("unlocks the membership for every local crew price", () => {
    const code = source("stripe-webhook");
    expect(code).toContain("isCrewSubscription(priceIds, sub.metadata?.product)");
    expect(code).not.toContain("CREW_PRICE_ID)");
  });
});

describe("company free trial signup", () => {
  const code = source("create-trial-signup");
  it("asks for a card only once the company plans are open, a plan was chosen and the request isn't from the apps", () => {
    const plans = code.indexOf("if (plan && !fromNativeApp(req) && trialTakesCard(stripeKey, plansOpenFor(await billingRollout(admin), userId))) {");
    expect(plans).toBeGreaterThan(0);
    // The plan path makes no Stripe call: checkout runs through company-billing after the app signs in.
    expect(code).not.toMatch(/new Stripe\(|stripe\.\w+\.\w+\(/);
    expect(code).toContain("checkout_next: true");
    expect(code).not.toContain("DEMO_PRICE_ID");
  });
  it("otherwise starts the no-card trial, always with an end date", () => {
    const trials = [...code.matchAll(/subscription_tier:\s*["']demo_trial["'][^\n]*/g)].map((m) => m[0]);
    expect(trials).toEqual(['subscription_tier: "demo_trial", trial_ends_at: trialEndsAt }).eq("id", userId);']);
    expect(code.indexOf('subscription_tier: "demo_trial"')).toBeGreaterThan(code.indexOf("checkout_next: true"));
    expect(code).toContain("url: `${origin}/login?trial=started`");
  });
  it("finds an existing account without listing users (first page only)", () => {
    expect(code).not.toContain("listUsers(");
    expect(code).toContain("signInWithPassword({ email, password })");
  });
  it("marks mistakes the person can fix so they aren't reported as incidents", () => {
    expect(code).toContain("fixable: err instanceof Fixable");
  });
  it("never turns an existing login into a new company", () => {
    expect(code).toContain('current?.role === "admin" || current?.parent_contractor_id || current?.account_type === "subcontractor"');
    expect(code).toContain("hasScoutAccess(userId, userId,");
    expect(code).toContain("if (!existing.company_name) fill.company_name = company_name;");
    expect(code).toContain("if (!existing && city && String(city).trim())");
    // role and account_type are written only for a new account
    const existingBranch = code.indexOf("if (existing) {");
    const newBranch = code.indexOf('await admin.from("profiles").upsert({');
    expect(newBranch).toBeGreaterThan(existingBranch);
    expect(code.indexOf('account_type: "company"')).toBeGreaterThan(newBranch);
    expect(code).toContain('await authClient.auth.signOut({ scope: "local" })');
  });
});

describe("crew-join", () => {
  const code = source("crew-join");
  const handler = code.slice(code.indexOf("Deno.serve("));

  it("uses an existing account only through its password, and signs that check out", () => {
    expect(handler).not.toContain("userId = existingProfile.id");
    const checks = handler.split("userId = await passwordOwner();\n").length - 1;
    expect(checks).toBe(2); // the email in profiles, and an email written differently there
    expect(handler.split("if (!userId) return json({ error: existingAccount }, 400);").length - 1).toBe(2);
    expect(handler).toContain('await authClient.auth.signOut({ scope: "local" })');
  });

  it("reports real failures (500) and keeps the 8-character rule for new accounts only", () => {
    expect(handler).toContain("if (insErr) return json({ error: insErr.message }, 500);");
    const newAccount = handler.indexOf("} else {", handler.indexOf("if (existingProfile) {"));
    expect(handler.indexOf("password.length < 8")).toBeGreaterThan(newAccount);
  });

  it("only sets name, phone and account type on an account it just created", () => {
    const updates = [...handler.matchAll(/from\("profiles"\)\.update\(/g)].map((m) => m.index ?? 0);
    expect(updates.length).toBe(2);
    const created = handler.indexOf("userId = created.user.id");
    const guarded = handler.indexOf('if (isNewAccount) await admin.from("profiles").update(');
    expect(updates[0]).toBeGreaterThan(created); // right after createUser
    expect(updates[1]).toBe(guarded + "if (isNewAccount) await admin.".length);
  });
});

describe("functions that text people", () => {
  // No caller in the app; their only callers are other functions sending the service key (checked 2026-10-13).
  const GUARDED = [
    "send-update-alert", "send-estimate-update-alert", "send-okc-timber-alert", "diag-twilio-send",
    "send-sms", "notify-new-lead", "notify-admin-transaction",
  ];
  for (const fn of GUARDED) {
    it(`${fn} lets only the service key or an admin in, before it reads or sends anything`, () => {
      const code = source(fn);
      const handler = code.slice(Math.max(code.indexOf("Deno.serve("), code.indexOf("\nserve(")));
      const guard = handler.indexOf("if (!(await isServiceOrAdmin(req))) return notAllowed(corsHeaders);");
      expect(guard).toBeGreaterThan(0);
      for (const later of ["req.json()", "api.twilio.com", "sendSMS(", "sendSms("]) {
        const at = handler.indexOf(later);
        if (at > 0) expect(at, `${fn}: ${later} comes after the guard`).toBeGreaterThan(guard);
      }
    });
  }

  it("only a company with Scout can invite crew or open jobs for bids, as in the app", () => {
    const invite = source("crew-invite");
    const inviteCheck = invite.indexOf("companyHasScout(admin, ownerId, u.user.id)");
    expect(inviteCheck).toBeGreaterThan(0);
    expect(invite.indexOf("sendSms(", invite.indexOf("Deno.serve("))).toBeGreaterThan(inviteCheck);
    const bids = source("bid-request-create");
    const bidsCheck = bids.indexOf("(!createdBy || !(await companyHasScout(admin, ownerId, createdBy)))");
    expect(bidsCheck).toBeGreaterThan(0);
    // Oklahoma Free-plan owners skip the Scout check but every send claims one of the monthly free jobs first.
    const freeClaim = bids.indexOf("claimFreeUse(admin, ownerId, 'job', newRequestId)");
    expect(freeClaim).toBeGreaterThan(0);
    expect(bids.indexOf("linkNetworkSubs(", bids.indexOf("Deno.serve("))).toBeGreaterThan(freeClaim);
    // Versioned companies (2026-10) go through the company permission check instead.
    expect(bids.indexOf("company_has_permission", bids.indexOf("Deno.serve("))).toBeGreaterThan(0);
    expect(bids.indexOf("linkNetworkSubs(", bids.indexOf("Deno.serve("))).toBeGreaterThan(bidsCheck);
  });

  it("a subcontractor login can't invite crew or open jobs for bids", () => {
    const invite = source("crew-invite");
    expect(invite.indexOf('ownerProfile?.account_type === "subcontractor"')).toBeGreaterThan(0);
    expect(invite.indexOf("sendSms(", invite.indexOf("Deno.serve(")))
      .toBeGreaterThan(invite.indexOf('ownerProfile?.account_type === "subcontractor"'));
    const bids = source("bid-request-create");
    const check = bids.indexOf('!isInternal && ownerProfile?.account_type === "subcontractor"');
    expect(check).toBeGreaterThan(0);
    expect(bids.indexOf("linkNetworkSubs(", bids.indexOf("Deno.serve("))).toBeGreaterThan(check);
  });

  it("crew-join texts the owner once per new request, with a capped name", () => {
    const code = source("crew-join");
    expect(code).toContain("if (owner?.phone && !existingCrew)");
    expect(code).toContain("body.fullName.trim().slice(0, 80)");
  });
});

describe("crew signup's area check", () => {
  const code = source("crew-market-quote");
  it("looks places up through Lovable's maps gateway, as geo-reverse does", () => {
    expect(code).toContain("https://connector-gateway.lovable.dev/google_maps");
    expect(code).toContain('"X-Connection-Api-Key": mapsKey');
    expect(code).not.toContain("https://maps.googleapis.com");
  });
  it("never stops signup when a place can't be looked up", () => {
    expect(code).not.toContain("We couldn't find that location");
    expect(code).toContain("place?.lat ?? NaN");
  });
});

describe("while Stripe is on a test key", () => {
  it("crew checkout charges nobody, before any price or Stripe call", () => {
    const code = source("create-crew-checkout");
    const free = code.indexOf("if (!stripeTakesRealCards(stripeKey)) return new Response(JSON.stringify({ free: true })");
    expect(free).toBeGreaterThan(0);
    expect(code.indexOf("myCrewMarket(admin, ownerId)")).toBeGreaterThan(free);
    expect(code.indexOf("stripe.checkout.sessions.create(")).toBeGreaterThan(free);
  });
  it("the membership screen is told billing is in test mode", () => {
    expect(source("crew-market-quote")).toContain('stripeTakesRealCards(Deno.env.get("STRIPE_SECRET_KEY")) ? "live" : "test"');
  });
});

describe("no-card trial", () => {
  it("is one per account: an ended trial doesn't restart", () => {
    const code = source("create-trial-signup");
    const once = code.indexOf('if (existing?.subscription_tier === "demo_trial") {');
    expect(once).toBeGreaterThan(code.indexOf("checkout_next: true"));
    expect(code.indexOf('subscription_tier: "demo_trial"')).toBeGreaterThan(once);
  });
});

describe("company signup links", () => {
  it("name only a live company, never a sandbox (demo) one", () => {
    const code = source("crew-market-quote");
    expect(code).toContain('const live = p && !p.is_sandbox && (p.account_type ?? "company") === "company";');
    expect(code).toContain("return json({ company: live ? (p.company_name || null) : null });");
  });
});
