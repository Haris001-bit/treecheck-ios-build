// Financial Pulse: accounts a bank stops sharing are closed (pulse-get stops counting them as payroll
// money) and their uncleared charges are removed; one that comes back is open again with the owner's
// choices as they were; an empty reply from the bank never closes anything.
import { describe, expect, it } from "vitest";
import { reconcileAccounts } from "../../../supabase/functions/_shared/pulse/accountReconcile";

interface AccountRow { id: string; account_id: string; owner_id: string; item_row_id: string; status: string; use_for_payroll: boolean }
interface TxnRow { transaction_id: string; owner_id: string; account_row_id: string; pending: boolean }

// Just enough of supabase-js for reconcileAccounts: one select with two eq filters, updates by id
// list, and a delete of pending rows by account.
function fakeAdmin(rows: AccountRow[], txns: TxnRow[] = []) {
  const state = { rows: rows.map((r) => ({ ...r })), txns: txns.map((t) => ({ ...t })), updates: 0 };
  const admin = {
    from(table: string) {
      if (table === "plaid_transactions") {
        return {
          delete: () => ({
            eq: (_c1: string, owner: string) => ({
              in: (_c2: string, ids: string[]) => ({
                eq: async (_c3: string, pending: boolean) => {
                  state.txns = state.txns.filter((t) => !(t.owner_id === owner && ids.includes(t.account_row_id) && t.pending === pending));
                  return { error: null };
                },
              }),
            }),
          }),
        };
      }
      expect(table).toBe("plaid_accounts");
      return {
        select: () => {
          const filters: Record<string, string> = {};
          const q = {
            eq(col: string, val: string) {
              filters[col] = val;
              return Object.keys(filters).length === 2
                ? Promise.resolve({ data: state.rows.filter((r) => Object.entries(filters).every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v)), error: null })
                : q;
            },
          };
          return q;
        },
        update: (patch: Partial<AccountRow>) => ({
          eq: (col: string, val: string) => ({
            in: async (_c: string, ids: string[]) => {
              state.updates++;
              for (const r of state.rows) if ((r as unknown as Record<string, unknown>)[col] === val && ids.includes(r.id)) Object.assign(r, patch);
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return { admin, state };
}

const row = (id: string, over: Partial<AccountRow> = {}): AccountRow => ({
  id, account_id: `plaid-${id}`, owner_id: "owner-1", item_row_id: "item-1", status: "active", use_for_payroll: false, ...over,
});
const txn = (id: string, account: string, pending: boolean): TxnRow => ({ transaction_id: id, owner_id: "owner-1", account_row_id: account, pending });

describe("accounts a bank stops sharing", () => {
  it("closes an account the owner unticked and removes its uncleared charges, keeping its history", async () => {
    const { admin, state } = fakeAdmin(
      [row("chk", { use_for_payroll: true }), row("card")],
      [txn("t1", "chk", true), txn("t2", "chk", false), txn("t3", "card", true)],
    );
    const changed = await reconcileAccounts(admin, "owner-1", "item-1", new Set(["plaid-card"]));
    expect(changed).toBe(true);
    expect(state.rows.find((r) => r.id === "chk")?.status).toBe("closed");
    expect(state.rows.find((r) => r.id === "card")?.status).toBe("active");
    expect(state.txns.map((t) => t.transaction_id).sort()).toEqual(["t2", "t3"]);
  });

  it("keeps the owner's payroll choice, so an account shared again pays payroll again", async () => {
    const { admin, state } = fakeAdmin([row("chk", { use_for_payroll: true }), row("card")]);
    await reconcileAccounts(admin, "owner-1", "item-1", new Set(["plaid-card"]));
    expect(state.rows.find((r) => r.id === "chk")).toMatchObject({ status: "closed", use_for_payroll: true });
    await reconcileAccounts(admin, "owner-1", "item-1", new Set(["plaid-chk", "plaid-card"]));
    expect(state.rows.find((r) => r.id === "chk")).toMatchObject({ status: "active", use_for_payroll: true });
  });

  it("never closes everything on an empty reply", async () => {
    const { admin, state } = fakeAdmin([row("chk"), row("card")]);
    expect(await reconcileAccounts(admin, "owner-1", "item-1", new Set())).toBe(false);
    expect(state.rows.every((r) => r.status === "active")).toBe(true);
    expect(state.updates).toBe(0);
  });

  it("changes nothing when every stored account is still shared", async () => {
    const { admin, state } = fakeAdmin([row("chk"), row("card")]);
    expect(await reconcileAccounts(admin, "owner-1", "item-1", new Set(["plaid-chk", "plaid-card"]))).toBe(false);
    expect(state.updates).toBe(0);
  });

  it("leaves a revoked account to the webhook and never touches another bank's accounts", async () => {
    const { admin, state } = fakeAdmin([
      row("old", { status: "revoked" }),
      row("chk"),
      row("other", { item_row_id: "item-2" }),
    ]);
    await reconcileAccounts(admin, "owner-1", "item-1", new Set(["plaid-chk", "plaid-old"]));
    expect(state.rows.find((r) => r.id === "old")?.status).toBe("revoked");
    expect(state.rows.find((r) => r.id === "other")?.status).toBe("active");
  });
});
