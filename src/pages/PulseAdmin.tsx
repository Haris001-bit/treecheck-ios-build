// Financial Pulse admin page (route /dashboard/admin/pulse).
// TreeCheck admins only; the pulse-admin function checks the admin role again on every call.
import { useCallback, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PulseAdminScreen } from "@/components/pulse/admin/PulseAdminScreen";
import { companyName, isAdminFailure, pulseAdminApi, type AdminCompany, type PlaidEnv } from "@/lib/pulse/adminApi";

export default function PulseAdmin() {
  const { isAdmin, roleLoading } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rowMessage, setRowMessage] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: ["pulse-admin", "list"],
    enabled: isAdmin,
    queryFn: async () => {
      const r = await pulseAdminApi.list();
      if (isAdminFailure(r)) throw new Error(r.error);
      return r.companies;
    },
  });
  const health = useQuery({
    queryKey: ["pulse-admin", "health"],
    enabled: isAdmin,
    queryFn: async () => {
      const r = await pulseAdminApi.health();
      if (isAdminFailure(r)) throw new Error(r.error);
      return r;
    },
  });

  const change = useCallback(async (c: AdminCompany, patch: { enabled?: boolean; plaid_env?: PlaidEnv; max_items?: number }, done: string) => {
    setBusy((b) => new Set(b).add(c.owner_id));
    setRowMessage((m) => ({ ...m, [c.owner_id]: "" }));
    const r = await pulseAdminApi.setAccess({ owner_id: c.owner_id, enabled: patch.enabled ?? c.enabled, ...("plaid_env" in patch ? { plaid_env: patch.plaid_env } : {}), ...("max_items" in patch ? { max_items: patch.max_items } : {}) });
    setBusy((b) => { const n = new Set(b); n.delete(c.owner_id); return n; });
    if (isAdminFailure(r)) {
      setRowMessage((m) => ({ ...m, [c.owner_id]: r.error }));
      return;
    }
    toast.success(done);
    await qc.invalidateQueries({ queryKey: ["pulse-admin"] });
  }, [qc]);

  if (roleLoading) {
    return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>;
  }
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <PulseAdminScreen
      companies={list.data ?? null}
      health={health.data ?? null}
      loadError={list.isError ? (list.error as Error).message : null}
      busy={busy}
      rowMessage={rowMessage}
      onRetry={() => { void list.refetch(); void health.refetch(); }}
      onToggle={(c, enabled) => void change(c, { enabled }, enabled ? `Financial Pulse is on for ${companyName(c.company)}.` : `Financial Pulse is off for ${companyName(c.company)}.`)}
      onMode={(c, env) => void change(c, { plaid_env: env }, `${companyName(c.company)} now uses ${env === "production" ? "real" : "test"} banks.`)}
      onLimit={(c, n) => void change(c, { max_items: n }, `${companyName(c.company)} can link up to ${n} bank${n === 1 ? "" : "s"}.`)}
      onFind={async (email) => {
        const r = await pulseAdminApi.find(email);
        return isAdminFailure(r) ? { error: r.error } : { company: r.company };
      }}
      onEnable={async (found) => {
        const r = await pulseAdminApi.setAccess({ owner_id: found.owner_id, enabled: true, plaid_env: "production", max_items: 2 });
        if (isAdminFailure(r)) { toast.error(r.error); return false; }
        await qc.invalidateQueries({ queryKey: ["pulse-admin"] });
        return true;
      }}
    />
  );
}
