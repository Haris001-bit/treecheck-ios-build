// Financial Pulse two-tenant isolation check against the LIVE database.
//
// Signs in with TreeCheck TEST logins using the public (anon) key only and checks that each
// login can see only what it should. It only ever requests row COUNTS (head requests), never
// row contents, so no finance data is printed or stored. Logins are typed at runtime (or read
// from environment variables) and are never written anywhere.
//
// Run from the repo root:  node scripts/pulse-isolation-check.mjs
// Optional env vars: PULSE_TEST_A_EMAIL / _PASSWORD, PULSE_TEST_B_EMAIL / _PASSWORD,
//                    PULSE_TEST_A1_EMAIL / _PASSWORD  (A = owner with Pulse on, B = another
//                    owner with Pulse on, A1 = a team member of A)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import readline from "node:readline";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !ANON) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env");
  process.exit(2);
}

const OWNER_TABLES = [
  "pulse_settings", "pulse_categories", "pulse_rules", "plaid_link_consents", "plaid_items",
  "plaid_accounts", "plaid_transactions", "jobber_jobs", "jobber_visit_revenue", "jobber_payments", "pulse_snapshots",
];
const SEALED_TABLES = ["plaid_item_secrets", "plaid_slot_ledger", "jobber_sync_state", "pulse_events"];
const SERVER_RPCS = [
  ["plaid_claim_sync", { p_item_row_id: "00000000-0000-0000-0000-000000000000", p_seconds: 1 }],
  ["plaid_release_sync", { p_item_row_id: "00000000-0000-0000-0000-000000000000" }],
  ["plaid_commit_cursor", { p_item_row_id: "00000000-0000-0000-0000-000000000000", p_old_cursor: null, p_new_cursor: "x" }],
  ["plaid_slots_used", { p_env: "production" }],
  ["pulse_seed_categories", { p_owner: "00000000-0000-0000-0000-000000000000" }],
  ["pulse_window_totals", { p_owner: "00000000-0000-0000-0000-000000000000", p_tz: "America/Chicago", p_windows: [] }],
];

const results = [];
const record = (name, pass, detail = "") => results.push({ name, pass, detail });

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function login(label, key) {
  const email = process.env[`PULSE_TEST_${key}_EMAIL`] || (await ask(`${label} email: `));
  const password = process.env[`PULSE_TEST_${key}_PASSWORD`] || (await ask(`${label} password: `, true));
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`${label}: sign-in failed (${error?.message ?? "no user"})`);
  return { client, id: data.user.id, label };
}

async function count(client, table, filter) {
  let q = client.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count: n, error } = await q;
  return { n, error };
}

async function checkUser(u, { expectOwnerAccess }) {
  const { data: ownerId, error: oerr } = await u.client.rpc("pulse_owner_id");
  if (expectOwnerAccess) {
    record(`${u.label}: pulse_owner_id() is own id`, !oerr && ownerId === u.id, oerr?.message ?? "");
  } else {
    record(`${u.label}: pulse_owner_id() is empty`, !oerr && ownerId == null, oerr?.message ?? String(ownerId));
  }

  for (const t of OWNER_TABLES) {
    const other = await count(u.client, t, (q) => q.neq("owner_id", u.id));
    record(`${u.label}: sees no other company's ${t}`, !other.error && other.n === 0, other.error?.message ?? `count ${other.n}`);
    const own = await count(u.client, t);
    if (expectOwnerAccess) {
      record(`${u.label}: can read own ${t} (rows: ${own.n ?? "?"})`, !own.error, own.error?.message ?? "");
    } else {
      record(`${u.label}: sees nothing in ${t}`, !own.error && own.n === 0, own.error?.message ?? `count ${own.n}`);
    }
  }

  for (const t of SEALED_TABLES) {
    const s = await count(u.client, t);
    record(`${u.label}: denied sealed ${t}`, !!s.error, s.error ? "" : `count ${s.n} returned`);
  }

  for (const [fn, args] of SERVER_RPCS) {
    const { error } = await u.client.rpc(fn, args);
    record(`${u.label}: cannot run ${fn}`, !!error, error ? "" : "call succeeded");
  }

  const ins = await u.client.from("pulse_rules").insert({
    owner_id: u.id, rule_type: "exclude_personal", match_kind: "merchant_name", match_value: "isolation-check", source: "owner_tap",
  });
  record(`${u.label}: cannot insert rules`, !!ins.error, ins.error ? "" : "insert succeeded");
  const upd = await u.client.from("pulse_access").update({ enabled: true }).eq("owner_id", u.id).select("owner_id");
  record(`${u.label}: cannot change its own Pulse switch`, !!upd.error || (upd.data ?? []).length === 0, upd.error ? "" : "update returned rows");
}

async function main() {
  console.log("Financial Pulse isolation check (counts only, no data is printed)\n");

  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const t of [...OWNER_TABLES, ...SEALED_TABLES, "pulse_access"]) {
    const r = await count(anon, t);
    record(`anon: nothing from ${t}`, !!r.error || r.n === 0, r.error ? "" : `count ${r.n}`);
  }

  const A = await login("Owner A (Pulse switched on)", "A");
  const B = await login("Owner B (Pulse switched on)", "B");
  const A1 = await login("Team member A1 (on A's team)", "A1");

  await checkUser(A, { expectOwnerAccess: true });
  await checkUser(B, { expectOwnerAccess: true });
  await checkUser(A1, { expectOwnerAccess: false });

  // Local sign-out only: the default (global) would also end these test logins' other sessions.
  for (const u of [A, B, A1]) await u.client.auth.signOut({ scope: "local" });

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass || !r.detail ? "" : "  <- " + r.detail}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
