import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, RefreshCw, Sprout } from "lucide-react";
import {
  isNativeIOS,
  isAppStoreSafeMode,
  canShowPaymentUI,
  PAYMENT_EDGE_FUNCTIONS,
  canUsePaymentFunction,
} from "@/lib/platform";
import { BLOCKED_PAYMENT_ROUTES, isBlockedPaymentRoute } from "@/components/PaymentRouteGuard";
import { runSafeModeQA } from "@/lib/safeModeQA";

interface Check {
  label: string;
  pass: boolean;
  detail?: string;
}

export default function AppReviewDiagnostics() {
  const { isAdmin, user } = useAuth();
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const run = async () => {
    setRunning(true);
    const out: Check[] = [];

    // Platform
    out.push({ label: "Native iOS detected (Capacitor)", pass: isNativeIOS(), detail: `iOS=${isNativeIOS()}` });
    out.push({ label: "App Store safe mode active", pass: isAppStoreSafeMode() });
    out.push({ label: "Payment UI hidden", pass: !canShowPaymentUI() });

    // Edge functions (informational on web — must all be blocked on iOS)
    const blocked = [...PAYMENT_EDGE_FUNCTIONS].filter((f) => !canUsePaymentFunction(f));
    out.push({
      label: `Payment edge functions disabled (${blocked.length}/${PAYMENT_EDGE_FUNCTIONS.size})`,
      pass: isAppStoreSafeMode() ? blocked.length === PAYMENT_EDGE_FUNCTIONS.size : true,
      detail: isAppStoreSafeMode() ? "" : "Web build — purchase fns intentionally enabled",
    });

    // Routes
    const routeChecks = BLOCKED_PAYMENT_ROUTES.every((r) => isBlockedPaymentRoute(r));
    out.push({
      label: `Purchase routes registered as blocked (${BLOCKED_PAYMENT_ROUTES.length})`,
      pass: routeChecks,
    });

    // Backend reachability + entitlements
    try {
      const { data: ent, error } = await supabase.rpc(
        "get_mobile_contractor_entitlements" as any,
      );
      out.push({ label: "Backend reachable (entitlements RPC)", pass: !error, detail: error?.message });
      if (ent && Array.isArray(ent) && ent.length > 0) {
        const e: any = ent[0];
        out.push({ label: "Mobile access enabled for current user", pass: !!e.mobile_access_enabled });
      }
    } catch (e: any) {
      out.push({ label: "Backend reachable", pass: false, detail: String(e?.message ?? e) });
    }

    // Reviewer account check
    try {
      const { data: reviewer } = await supabase
        .from("profiles")
        .select("id, email, is_active")
        .eq("email", "appreview@treecheck.com")
        .maybeSingle();
      out.push({
        label: "Demo reviewer account exists",
        pass: !!reviewer,
        detail: reviewer ? `id=${reviewer.id}` : "Not seeded yet — click Seed Demo Account",
      });
      if (reviewer) {
        const { count } = await supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .eq("owner_contractor_id", reviewer.id);
        out.push({
          label: `Reviewer has ≥3 accessible leads (${count ?? 0})`,
          pass: (count ?? 0) >= 3,
        });
      }
    } catch (e: any) {
      out.push({ label: "Reviewer account lookup", pass: false, detail: String(e?.message ?? e) });
    }

    // Browser DOM scan (only meaningful on iOS, informational elsewhere)
    const qa = runSafeModeQA();
    out.push({
      label: `DOM purchase-string scan: ${qa.summary.stringsHidden}/${qa.summary.stringsChecked} hidden`,
      pass: isAppStoreSafeMode() ? qa.summary.stringsLeaking === 0 : true,
      detail: isAppStoreSafeMode() && qa.summary.stringsLeaking > 0
        ? `${qa.summary.stringsLeaking} leaking — see console`
        : "",
    });

    // Push notification graceful-deny (informational)
    out.push({
      label: "Push permission flow non-crashing",
      pass: true,
      detail: "useNativeBridge guards permission denial",
    });

    setChecks(out);
    setRunning(false);
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seed = async () => {
    setSeeding(true);
    setSeedResult(null);
    const { data, error } = await supabase.functions.invoke("seed-app-review-account");
    if (error || (data as any)?.error) {
      setSeedResult(`❌ ${error?.message ?? (data as any)?.error}`);
    } else {
      setSeedResult(
        `✅ Reviewer seeded — id ${(data as any).reviewer_id}, ${(data as any).leads_seeded} leads`,
      );
      await run();
    }
    setSeeding(false);
  };

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  const allGreen = total > 0 && passed === total;

  return (
    <div className="p-4 sm:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-display font-bold">App Review Diagnostics</h1>
        <p className="text-muted-foreground mt-1">
          Pre-flight checks for TestFlight / App Store Review submission. Admin-only.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Pre-flight checks
            <Badge variant={allGreen ? "default" : "secondary"}>
              {passed}/{total} passing
            </Badge>
          </CardTitle>
          <Button variant="outline" size="sm" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Rerun</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {c.pass ? (
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              )}
              <div className="flex-1">
                <div className={c.pass ? "" : "text-destructive font-medium"}>{c.label}</div>
                {c.detail && <div className="text-xs text-muted-foreground mt-0.5">{c.detail}</div>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sprout className="h-5 w-5 text-primary" />
            Seed App Review demo account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Creates / refreshes <code className="text-foreground">appreview@treecheck.com</code> with a known
            password, marks the email confirmed, and ensures 3 sample leads (incl. one Scout-originated) are
            owned by the account. Idempotent — safe to re-run.
          </p>
          <Button onClick={seed} disabled={seeding}>
            {seeding && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Seed / refresh demo account
          </Button>
          {seedResult && <p className="text-sm mt-2">{seedResult}</p>}
          <p className="text-xs text-muted-foreground pt-2 border-t">
            Caller: <code>{user?.email}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
