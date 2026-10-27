import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { productionDb, readStatus, STATUS_OFF, type ProductionStatus } from '@/lib/production/client';

/** What the large-company setup may show this person (PS1's production_status). Any failure means all off. */
export function useProductionStatus(): { status: ProductionStatus; isLoading: boolean } {
  const { user, effectiveContractorId } = useAuth();
  const q = useQuery({
    queryKey: ['production-status', user?.id, effectiveContractorId],
    enabled: !!user,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      try {
        const { data, error } = await productionDb.rpc('production_status');
        if (error) return STATUS_OFF;
        return readStatus(data);
      } catch {
        return STATUS_OFF;
      }
    },
  });
  return { status: q.data ?? STATUS_OFF, isLoading: q.isLoading };
}
