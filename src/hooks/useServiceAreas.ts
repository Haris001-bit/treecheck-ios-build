import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';

export interface ServiceArea {
  id: string;
  contractor_id: string;
  city: string;
  region: string | null;
  created_at: string;
}

export function useServiceAreas() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['service-areas', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_areas' as any)
        .select('*')
        .eq('contractor_id', user!.id)
        .order('city', { ascending: true });

      if (error) throw error;
      return data as unknown as ServiceArea[];
    },
    enabled: !!user,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useAddServiceArea() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ city, region }: { city: string; region?: string }) => {
      const { data, error } = await supabase
        .from('service_areas' as any)
        .insert({
          contractor_id: user!.id,
          city,
          region: region || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-areas'] });
      toast.success('Service area added!');
    },
    onError: (error: Error) => {
      if (error.message.includes('duplicate')) {
        toast.error('You already serve this city');
      } else {
        toast.error(error.message || 'Failed to add service area');
      }
    },
  });
}

export function useRemoveServiceArea() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('service_areas' as any)
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-areas'] });
      toast.success('Service area removed');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove service area');
    },
  });
}
