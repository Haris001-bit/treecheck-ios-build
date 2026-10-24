// Two-step sign-in (Financial Pulse bank linking) must not reload the role: the role lookup's loading
// screen in ProtectedRoute would close the page mid-step. Other session events keep reloading it.
// Rendered with React's own renderer in jsdom (no extra test library).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
  setSession: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
}));
const single = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) },
}));

import { AuthProvider, useAuth } from "./auth";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

type Seen = { loading: boolean; roleLoading: boolean; token: string | null; isContractor: boolean };
let emit: (event: string, session: unknown) => void = () => {};
const session = (token: string, userId = "u1") => ({ access_token: token, refresh_token: `r-${token}`, user: { id: userId } });

function Probe({ seen }: { seen: Seen[] }) {
  const a = useAuth();
  seen.push({ loading: a.loading, roleLoading: a.roleLoading, token: a.session?.access_token ?? null, isContractor: a.isContractor });
  return null;
}

async function until(check: () => void, ms = 2000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      check();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

async function signedIn(): Promise<Seen[]> {
  const seen: Seen[] = [];
  await act(async () =>
    root.render(
      <AuthProvider>
        <Probe seen={seen} />
      </AuthProvider>,
    ),
  );
  await until(() => expect(seen[seen.length - 1]).toEqual({ loading: false, roleLoading: false, token: "t1", isContractor: true }));
  return seen;
}

beforeEach(() => {
  localStorage.clear();
  auth.onAuthStateChange.mockReset().mockImplementation((cb: typeof emit) => {
    emit = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  auth.getSession.mockReset().mockResolvedValue({ data: { session: session("t1") } });
  single.mockReset().mockResolvedValue({ data: { role: "contractor", is_founder: false, parent_contractor_id: null }, error: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("AuthProvider and two-step sign-in", () => {
  it("takes the raised session without reloading the role", async () => {
    const seen = await signedIn();
    expect(single).toHaveBeenCalledTimes(1);
    const from = seen.length;

    await act(async () => emit("MFA_CHALLENGE_VERIFIED", session("t2")));
    await until(() => expect(seen[seen.length - 1].token).toBe("t2"));

    expect(single).toHaveBeenCalledTimes(1);
    expect(seen.slice(from).some((s) => s.roleLoading || s.loading)).toBe(false);
    expect(seen[seen.length - 1].isContractor).toBe(true);
    expect(JSON.parse(localStorage.getItem("treecheck_session_backup") ?? "{}")).toEqual({ access_token: "t2", refresh_token: "r-t2" });
  });

  it("still reloads the role for other session events", async () => {
    await signedIn();
    await act(async () => emit("TOKEN_REFRESHED", session("t3")));
    await until(() => expect(single).toHaveBeenCalledTimes(2));
  });

  it("treats a verified code for a different user like any other sign-in", async () => {
    await signedIn();
    await act(async () => emit("MFA_CHALLENGE_VERIFIED", session("t4", "u2")));
    await until(() => expect(single).toHaveBeenCalledTimes(2));
  });
});
