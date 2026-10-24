import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isNativeIOS } from "@/lib/platform";

export interface MobileEntitlements {
  contractor_id: string;
  account_owner_id: string;
  role: string;
  mobile_access_enabled: boolean;
  account_status: string;
  can_view_assigned_leads: boolean;
  can_view_unlocked_leads: boolean;
  can_use_scout: boolean;
  can_use_dma: boolean;
  can_use_lsa: boolean;
  can_use_marketing_package: boolean;
  premium_active: boolean;
  subscription_status: string;
  subscription_current_period_end: string | null;
  ios_app_store_safe_mode: boolean;
  last_entitlement_sync_at: string;
}

/**
 * Read-only entitlement fetcher for the iOS companion app.
 * - Never trusts cached data for paid access — always re-queries before showing PII.
 * - Refreshes on login, app resume, and manual refresh.
 */
export function useMobileEntitlements() {
  const [entitlements, setEntitlements] = useState<MobileEntitlements | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_mobile_contractor_entitlements" as any);
    if (!error && data && Array.isArray(data) && data.length > 0) {
      setEntitlements(data[0] as MobileEntitlements);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());

    // Refresh on app resume (iOS Capacitor + web)
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { entitlements, loading, refresh, isIOS: isNativeIOS() };
}

export async function fetchMobileAccessibleLeads() {
  const { data, error } = await supabase.rpc("get_mobile_accessible_leads" as any);
  if (error) throw error;
  return data ?? [];
}
