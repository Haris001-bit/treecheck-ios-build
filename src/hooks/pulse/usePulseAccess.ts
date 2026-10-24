// Financial Pulse access for the signed-in user.
// pulse_owner_id() returns the user's own id only for a company owner whose Pulse switch is on;
// team members, subcontractors and owners without the switch get null (and no finance rows).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { isPulseNativePlatform, pulseSurfaceAllowed } from "@/lib/pulse/flags";

export interface PulseAccessRow {
  enabled: boolean;
  plaid_env: string;
  max_items: number;
}

interface PulseAccessData {
  ownerId: string | null;
  access: PulseAccessRow | null;
}

export const PULSE_ACCESS_QUERY_KEY = "pulse-access";

export function usePulseAccess() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const surfaceAllowed = pulseSurfaceAllowed();
  const enabled = !!userId && surfaceAllowed;

  const query = useQuery({
    queryKey: [PULSE_ACCESS_QUERY_KEY, userId],
    enabled,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<PulseAccessData> => {
      if (!userId) return { ownerId: null, access: null };
      const { data: ownerId, error } = await supabase.rpc("pulse_owner_id");
      if (error) throw new Error("pulse_access_check_failed");

      const { data: access, error: accessError } = await supabase
        .from("pulse_access")
        .select("enabled, plaid_env, max_items")
        .eq("owner_id", userId)
        .maybeSingle();
      if (accessError) throw new Error("pulse_access_check_failed");

      return {
        ownerId: typeof ownerId === "string" && ownerId ? ownerId : null,
        access: access ?? null,
      };
    },
  });

  const ownerId = query.data?.ownerId ?? null;
  return {
    loading: authLoading || (enabled && query.isPending),
    allowed: surfaceAllowed && !!ownerId,
    ownerId,
    access: query.data?.access ?? null,
    isNative: isPulseNativePlatform(),
    failed: enabled && query.isError && !query.data,
    retry: () => {
      void query.refetch();
    },
  };
}
