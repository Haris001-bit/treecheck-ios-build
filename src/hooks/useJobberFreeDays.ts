import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { blockedDaysFrom, type BlockedReason } from '@/lib/jobberFreeDays';

/**
 * The days a job's climber can't pick (booked in Jobber or closed), for greying them out in the day
 * pickers. Empty while loading, when the company's free_days switch is off, or when the calendar can't
 * be read; the server still checks every pick.
 */
export function useJobberFreeDays(requestId: string | null | undefined) {
  return useQuery({
    queryKey: ['jobber-free-days', requestId],
    enabled: !!requestId,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, BlockedReason>> => {
      const { data, error } = await supabase.functions.invoke('jobber-free-days', { body: { bid_request_id: requestId } });
      if (error) return new Map();
      return blockedDaysFrom(data);
    },
  });
}
