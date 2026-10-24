import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import type { Permissions } from '@/lib/pricing/catalog';

export function useCompanyPermission(permission: keyof Permissions) {
  const { user, effectiveContractorId } = useAuth();
  return useQuery({ queryKey: ['company-permission', user?.id, effectiveContractorId, permission], enabled: !!user && !!effectiveContractorId,
    queryFn: async () => {
      if (!effectiveContractorId) return false;
      const { data, error } = await supabase.rpc('company_has_permission', { p_owner: effectiveContractorId, p_permission: permission });
      if (error) throw error;
      return data === true;
    }, staleTime: 10_000 });
}