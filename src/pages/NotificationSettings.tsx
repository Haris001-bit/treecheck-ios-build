import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

const isDevelopment = import.meta.env.VITE_DEVELOPMENT === "true";

/**
 * App Store-safe notification preferences.
 *
 * Hides marketing toggles by default (off + hidden in the first App Review
 * iOS build). Only operational toggles are exposed: lead alerts, account
 * alerts, and Scout alerts (mapped to lead alerts).
 */
export default function NotificationSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [leadAlerts, setLeadAlerts] = useState(true);
  const [accountAlerts, setAccountAlerts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("device_tokens" as any)
        .select("lead_alerts_enabled, account_alerts_enabled")
        .eq("contractor_id", user.id)
        .is("revoked_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const row = data as { lead_alerts_enabled?: boolean; account_alerts_enabled?: boolean } | null;
      if (row) {
        setLeadAlerts(row.lead_alerts_enabled !== false);
        setAccountAlerts(row.account_alerts_enabled !== false);
      }
      setLoading(false);
    })();
  }, [user]);

  async function update(field: "lead_alerts_enabled" | "account_alerts_enabled", value: boolean) {
    if (!user) return;
    const { error } = await supabase
      .from("device_tokens" as any)
      .update({ [field]: value } as any)
      .eq("contractor_id", user.id);
    if (error) {
      toast({ title: "Could not update", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
  }

  async function sendTestNotification() {
    if (!user) return;
    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-push", {
        body: {
          contractor_ids: [user.id],
          notification_type: "account_activity_non_payment",
          title: "TreeCheck test",
          body: "Development test notification.",
          data: {
            type: "account_activity_non_payment",
            notification_type: "account_activity_non_payment",
            route_target: "dashboard",
          },
        },
      });
      if (error) throw error;

      const sent = (data as { sent?: number } | null)?.sent ?? 0;
      toast({
        title: sent > 0 ? "Test notification sent" : "No device received push",
        description:
          sent > 0
            ? `Delivered to ${sent} device(s).`
            : "Grant push permission on a device and open the app while logged in, then try again.",
        variant: sent > 0 ? "default" : "destructive",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast({ title: "Test failed", description: message, variant: "destructive" });
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Choose which account activity sends a push notification to this device. The app
            works fine if notifications are off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="lead-alerts" className="text-base font-medium">Lead alerts</Label>
              <p className="text-sm text-muted-foreground">
                New and updated leads in Your Leads, including Scout leads.
              </p>
            </div>
            <Switch
              id="lead-alerts"
              checked={leadAlerts}
              disabled={loading}
              onCheckedChange={(v) => { setLeadAlerts(v); update("lead_alerts_enabled", v); }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="account-alerts" className="text-base font-medium">Account alerts</Label>
              <p className="text-sm text-muted-foreground">
                General account activity such as updates and responses.
              </p>
            </div>
            <Switch
              id="account-alerts"
              checked={accountAlerts}
              disabled={loading}
              onCheckedChange={(v) => { setAccountAlerts(v); update("account_alerts_enabled", v); }}
            />
          </div>

          {!Capacitor.isNativePlatform() && (
            <p className="text-xs text-muted-foreground pt-2 border-t">
              Push notifications are delivered on the installed mobile app.
            </p>
          )}

          {isDevelopment && (
            <div className="pt-4 border-t space-y-2">
              <p className="text-sm font-medium">Development</p>
              <p className="text-xs text-muted-foreground">
                Sends a test push to devices registered for this account via FCM.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={sendingTest || loading || !user}
                onClick={sendTestNotification}
              >
                {sendingTest ? "Sending…" : "Send test notification"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
