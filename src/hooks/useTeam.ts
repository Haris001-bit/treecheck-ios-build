import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { functionFailure } from '@/lib/functionFailure';

export interface TeamSeats {
  seat_quantity: number;
  status: string;
  stripe_subscription_id: string | null;
}

export interface TeamMember {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
}

export interface TeamInvitation {
  id: string;
  email: string;
  invite_token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export function useTeamSeats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['team-seats', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_seats' as any)
        .select('*')
        .eq('contractor_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TeamSeats | null;
    },
    enabled: !!user,
  });
}

export function useTeamMembers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['team-members', user?.id],
    queryFn: async () => {
      // profiles RLS only shows a user their own row; team_directory() returns the owner's teammates' contact details.
      const { data, error } = await supabase.rpc('team_directory' as any);
      if (error) throw error;
      return (data ?? []) as unknown as TeamMember[];
    },
    enabled: !!user,
  });
}

export function useTeamInvitations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['team-invitations', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_invitations' as any)
        .select('*')
        .eq('parent_contractor_id', user!.id)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as TeamInvitation[];
    },
    enabled: !!user,
  });
}

export function useSetTeamSeatQuantity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (quantity: number) => {
      const { data, error } = await supabase.functions.invoke('manage-team-seat', {
        body: { action: 'set_quantity', quantity },
      });
      // The function's own reason ("No Stripe customer found...") instead of the generic non-2xx text.
      const failure = await functionFailure(error, data);
      if (failure) throw new Error(failure.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-seats'] });
      toast.success('Seats updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useInviteTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, phone, fullName }: { email: string; phone?: string; fullName?: string }) => {
      const { data, error } = await supabase.functions.invoke('invite-team-member', {
        body: { email, phone, fullName },
      });
      // The function's own reason ("No available seats. Add a seat first") instead of the generic non-2xx text.
      const failure = await functionFailure(error, data);
      if (failure) throw new Error(failure.message);
      return data as {
        success: boolean; invite_url?: string; attached?: boolean;
        email_sent?: boolean; sms_sent?: boolean;
      };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['team-invitations'] });
      qc.invalidateQueries({ queryKey: ['team-members'] });
      const channels = [data.email_sent && 'email', data.sms_sent && 'text'].filter(Boolean).join(' and ');
      const base = data.attached ? 'Team member added' : 'Invitation created';
      toast.success(channels ? `${base} — instructions sent by ${channels}` : base);
      if (!data.email_sent) toast.error("Couldn't send the email — share the invite link manually.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('profiles')
        .update({ parent_contractor_id: null })
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Removed from team');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
