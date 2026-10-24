import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

/**
 * Registers the device for native FCM push notifications, stores the token
 * in `device_tokens` (with platform/app_version/device_id/preferences), and
 * handles notification taps using the read-only Supabase entitlement RPC
 * `mobile_can_access_lead`.
 *
 * App Store safety:
 *  - Push receipt never opens a purchase flow.
 *  - Tap on a lead_* notification re-checks Supabase access before navigating
 *    to Lead Detail. On miss, shows neutral "not available for this account".
 *  - App functions if permission is denied — push registration is best-effort.
 */
const APP_VERSION = "native-2026.06.01";

export function usePushNotifications() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!user) return;
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");

        const perm = await PushNotifications.checkPermissions();
        console.log("[push] permissions:", perm);
        let status = perm.receive;
        if (status === "prompt" || status === "prompt-with-rationale") {
          const r = await PushNotifications.requestPermissions();
          console.log("[push] requested permissions:", r);
          status = r.receive;
        }
        if (status !== "granted") {
          console.log("[push] permission not granted:", status);
          return;
        }

        const platform = Capacitor.getPlatform();

        let deviceId: string | null = null;
        try {
          deviceId = localStorage.getItem("tc.device_id");
          if (!deviceId) {
            deviceId = crypto.randomUUID();
            localStorage.setItem("tc.device_id", deviceId);
          }
          console.log("[push] deviceId:", deviceId);
        } catch {
          /* ignore */
        }

        console.log("[push] adding registration listener");
        const regListener = await PushNotifications.addListener("registration", async (token) => {
          console.log("[push] token received");
          try {
            await supabase
              .from("device_tokens")
              .upsert(
                {
                  contractor_id: user.id,
                  token: token.value,
                  platform,
                  provider: "fcm",
                  app_version: APP_VERSION,
                  device_id: deviceId,
                  last_seen_at: new Date().toISOString(),
                  revoked_at: null,
                } as any,
                { onConflict: "token" },
              );
            console.log("[push] token saved");
          } catch (e) {
            console.error("[push] failed to save token", e);
          }
        });

        console.log("[push] adding registration error listener");
        const errListener = await PushNotifications.addListener(
          "registrationError",
          (err) => console.error("[push] registration error", err),
        );

        console.log("[push] adding push notification received listener");
        const recvListener = await PushNotifications.addListener(
          "pushNotificationReceived",
          (n) => console.log("[push] received in foreground", n?.data?.type),
        );

        const tapListener = await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          async (action) => {
            const data = (action?.notification?.data || {}) as Record<string, string>;
            const type = data.notification_type || data.type;
            const leadId = data.lead_id;
            const routeTarget = data.route_target;
            console.log("[push] tap", { type, leadId, routeTarget });

            // Lead-scoped tap → re-verify entitlement before navigating
            if (leadId && (routeTarget === "lead_detail" || !routeTarget)) {
              try {
                const { data: canAccess, error } = await supabase.rpc(
                  "mobile_can_access_lead" as any,
                  { p_lead_id: leadId },
                );
                if (error || !canAccess) {
                  toast({
                    title: "Lead unavailable",
                    description: "This lead is not currently available for this account.",
                  });
                  navigate("/dashboard/purchased");
                  return;
                }
                navigate(`/dashboard/purchased?lead=${encodeURIComponent(leadId)}`);
                return;
              } catch (e) {
                console.error("[push] entitlement check failed", e);
                navigate("/dashboard/purchased");
                return;
              }
            }

            // Non-lead taps → safe default destinations
            if (type === "scout_lead_created" || data.route?.includes("scout")) {
              navigate("/dashboard/scout-inbox");
            } else if (typeof data.route === "string" && /^\/dashboard\/crew-bids(\?[\w=&%-]*)?$/.test(data.route)) {
              // Crew alerts open the exact job (or call-out) they're about.
              navigate(data.route);
            } else if (data.dispatch_id && /^[\w-]+$/.test(data.dispatch_id)) {
              navigate(`/dashboard/crew-bids?dispatch=${data.dispatch_id}`);
            } else if (data.bid_request_id && /^[\w-]+$/.test(data.bid_request_id)) {
              navigate(`/dashboard/crew-bids?job=${data.bid_request_id}`);
            } else {
              navigate("/dashboard");
            }
          },
        );

        console.log("[push] registering");
        await PushNotifications.register();
        console.log("[push] registered");

        cleanup = () => {
          regListener.remove();
          errListener.remove();
          recvListener.remove();
          tapListener.remove();
        };
      } catch (e) {
        console.error("[push] init error", e);
      }
    })();

    return () => cleanup?.();
  }, [user, navigate, toast]);
}
